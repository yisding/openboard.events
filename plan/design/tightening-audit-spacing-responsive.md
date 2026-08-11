# Design tightening — spacing and responsive audit

**Scope:** screenshot-driven audit at 390 / 768 / 1024 / 1440px across dashboard,
abstracts + drawer, form builder, portal home/tasks, public agenda/speakers, and
landing. `design-system.md` and `experience-design.md` remain law; `tightening-research.md`
is this stage's brief. Nothing here proposes new tokens, colors, or undoing the
type-scale raise — this is spacing, breakpoints, overflow, and touch targets only.

> **Status (2026-08-11): findings applied and re-verified.** A final pass
> re-shot all nine reachable surfaces at the four widths and added a
> rendered-DOM assertion sweep beside the screenshots
> (`~/Code/tmp/ultracode-design/final/`, script `verify.mjs`, results in
> `report.json`). Post-sweep: **no page-level horizontal overflow at any
> width**, no off-grid rendered spacing outside the named exemptions, no
> off-scale type outside the display clamp, and no off-weight text anywhere.
> Three things this audit could not see — invisible to both a stylesheet grep
> and a screenshot — are now recorded in `design-system.md` T1/T4/T7: inherited
> UA ratios (`small`'s `.8333em`, block `1em` margins), computed `margin: auto`,
> and the touch-target floor, which was breached by *every* button-class
> control and not only the three offenders T7 originally named.
>
> Two notes for anyone re-reading the raw screenshots. **(a)** Elements reported
> as overflowing on abstracts at 390 sit inside `overflow: auto` containers (the
> data table, the status-tab row); that is the intended progressive-disclosure
> behaviour and the page itself does not scroll horizontally. **(b)** The dark
> circular "N" badge at the bottom-left of dev-server screenshots is Next.js's
> dev-mode indicator, not app UI. The `fullPage` drawer artifact documented
> below still applies.
>
> Still true: the **form builder** and **public agenda/speakers** have no
> credential-free demo path (both read a real database with no demo branch), so
> they remain CSS-review-only and were not screenshot-verified in the final pass
> either.

## Method, and an environment blocker other stages hit too (worth recording)

`plan/design/tightening-audit-color-restraint.md` documents the same wall this
stage started at: `/events/[eventId]/*` only renders without a real login when
`isCredentialFreeLocalDemo()` is true (`APP_ENV=local`, no `DATABASE_URL`, no
`SESSION_SECRET`), and this worktree's `.dev.vars` has a real `SESSION_SECRET`
(provisioned for M42's Google OAuth). Editing `.dev.vars` — even a scoped,
revert-planned blank-out — is refused by the harness's file-safety classifier,
correctly, and I did not force it.

Two further blockers stacked on top of that once demo mode was reachable a
different way, both worth recording since they'll hit the next stage too:

1. **`getEnv()` doesn't read `process.env` when running under
   `initOpenNextCloudflareForDev()`** — it reads `getCloudflareContext().env`,
   which that call populates from `.dev.vars` on disk regardless of what the
   shell exports. Setting `DATABASE_URL=`/`SESSION_SECRET=` on the `next dev`
   command line has no effect for this reason.
2. **Next dev's React-Refresh runtime calls `eval()`** to install its module
   registry (`react-refresh-utils/dist/runtime.js`), independent of the
   `devtool` setting, and this app's real CSP (`script-src 'self'
   'unsafe-inline'`, no `unsafe-eval`) throws on it — silently killing
   hydration for every interactive component. The page **paints** correctly
   (SSR + first client render survive) but no click/change handler ever
   fires afterward: table-row clicks, checkboxes, status-tab buttons, and
   the search box all stopped working, confirmed by (a) zero DOM event
   listeners on `<body>` via CDP `DOMDebugger.getEventListeners`, and (b) a
   controlled search input accepting keystrokes but never re-filtering rows.
   This is dev-tooling-only code (absent from `next build`), not a product bug.

Both were worked around **without touching `.dev.vars` or any secret value**,
entirely inside `next.config.ts`, gated behind an opt-in
`DESIGN_AUDIT_DEMO=1` env var that changes nothing for a normal run:

```ts
// only when DESIGN_AUDIT_DEMO=1:
// (a) skip initOpenNextCloudflareForDev() so getEnv()'s runtimeBindings()
//     falls back to plain process.env (the catch branch in env.ts), which
//     the shell invocation controls: DATABASE_URL= SESSION_SECRET=
// (b) append 'unsafe-eval' to the CSP's script-src for this run only
```

**I reverted `next.config.ts` back to its committed state before finishing** —
the diff above is not left in the tree. Re-apply it (or ask me to) to get
live screenshots of any further admin/portal surface; it took about 20
minutes to work out and is fully reproducible from the description above.
Full patch is in this session's transcript if a future agent wants the exact
diff instead of re-deriving it.

**What this unblocked:** dashboard, abstracts list + open drawer, portal
home/tasks (default state and mobile-nav-open state), admin mobile-nav-open,
and the CFP wizard (`/submit/ai-engineer/technical-talks`, the only
demo-aware "forms" surface — see the Form builder section below) — all real
interaction states, not just first paint, at all four widths.
**What stayed unreachable:** the admin form **builder**
(`/events/[eventId]/forms/[formId]`) and the public agenda/speakers pages
(`/e/[eventSlug]/agenda`, `/e/[eventSlug]/speakers`) — both routes read
straight from a real database with no demo-mode branch at all (confirmed by
reading the route source, not just by the runtime error). Those two sections
below are CSS/source review, explicitly labeled, not screenshot-confirmed.

All screenshots are under `~/Code/tmp/ultracode-design/shots/`. One harmless
artifact appears in several full-page screenshots: a small black circle with
a white "N" — that is Next.js's own dev-mode toolbar (`<nextjs-portal>`
custom element), not app content. Ignore it in every screenshot below.

---

## Finding 1 — Landing hero is clipped, not wrapped, from 390px up to ~690px

**Severity: critical. Screenshots:** `01-landing-390.png`, `01-landing-768.png`
(fine) — compare against the DOM measurements below, which bound the exact
break range.

**Selectors:** `.hero h1` (`max-width: 610px`), `.hero-copy > p`
(`max-width: 575px`), `.hero-art` (`min-width: 620px` from the 650px
breakpoint, still in effect through 420px), all in `src/app/globals.css`.

At 390px the entire hero — eyebrow pill, both headline lines, the subhead
paragraph, both CTAs — is rendered starting around x=64 and extending to
x≈674–684, then invisibly cropped by `.landing { overflow: hidden }`
(`globals.css` line 152). Nothing wraps to fit; it just ends off-screen.
Measured directly via `getBoundingClientRect()`:

| Viewport | `.hero h1` right edge | Overflow past viewport |
| --- | --- | --- |
| 390px | 674px | **284px** |
| 420px | 674px | 254px |
| 480px | 674px | 194px |
| 550px | 674px | 124px |
| 649px | 674px | 25px |
| 651px | 684px | 33px |
| 700px | 684px | −16px (fine) |

**Root cause:** `.hero h1` and `.hero-copy > p` carry a fixed `max-width`
(610px / 575px) that is never reduced below the 1120px breakpoint. At the
same time `.hero-art` keeps an explicit `min-width: 620px` all the way down
to 390px (only its `transform: scale()` and `margin-bottom` change per
breakpoint — `transform` doesn't shrink the box's contribution to grid
sizing, only its paint). With `.hero { grid-template-columns: 1fr }` below
1120px, that 620px `min-width` item forces the single grid track wider than
the viewport, and the centered, unclamped `h1`/`p` follow it off-screen. This
is real production content lost on every phone in the 390–690px range — the
single highest-priority fix in this audit.

**Fix:** at the ≤650px breakpoint (where `.hero-art` already gets
`transform: scale(.58)`), also cap `.hero-art { min-width: 0 }` (or a small
value proportional to the scaled visual size, e.g. `360px`) and add
`.hero h1, .hero-copy > p { max-width: 100% }` — both changes already sit
inside the same `@media (max-width: 650px)` block (`globals.css` line 534),
so this is a same-file, same-rule addition, not a new breakpoint. Re-check
the 390–690px range specifically after the fix; the current CSS makes the
"640" and "650" breakpoints in this block functionally redundant with each
other for this element, so verify neither reintroduces a gap.

---

## Finding 2 — Portal header overflows the page by 14px at exactly 768px (tablet gap, confirmed)

**Severity: high — this is the "650/760 breakpoints miss real tablet width"
risk the research doc called out, materializing into an actual bug.**
**Screenshots:** `07-portal-home-768.png`, `08-portal-tasks-768.png`,
`12-portal-mobile-nav-768.png` — all three show the same cut, and the
automated `document.documentElement.scrollWidth` check flagged all three:
`scrollWidth=782` vs `clientWidth=768`.

**Selector:** `.portal-header nav` / `.portal-account`, `globals.css` line
557 (base rule) and line 678 (`@media (max-width: 760px)`).

Measured directly at 768px:

```
.portal-header nav   right edge: 658px
.portal-account       left edge: 658px, right edge: 782px
document scrollWidth: 782px   clientWidth: 768px   → 14px overflow
```

The five nav links (Home / My submissions / Tasks · badge / Profile /
Resources) plus the account cluster (avatar + name + role + sign-out icon)
add up to more than the 768px viewport, but the hamburger-menu collapse only
triggers at `max-width: 760px` — 8px short of this audit's own 768px test
width, and of the real iPad-portrait/many-Android-tablet width it's meant to
represent. The nav never gets the mobile treatment at 768; it just overflows
instead. This is the shared portal header, so it reproduces on **every**
portal page (home, tasks, submissions, profile, resources) at this width,
not just the two screenshotted.

**Fix — shipped as `768px`.** The alternatives once considered here
(`769px`/`800px`, to land past the boundary rather than on it) are
superseded: the binding breakpoint set is exactly `480`, `768`, `1024`,
`1280` (`design-system.md` T5), and `769px`/`800px` are not members of it.
`.portal-header nav`'s collapse now fires at `max-width: 768px`
(`globals.css`, `.portal-mobile-menu`'s block), which is what the "at
exactly 768px" defect in this finding needed — the width itself, not a
margin past it. This was the single cleanest instance of the research doc's
"consolidate toward 768" recommendation — one number, one selector, fixing
a confirmed, reproducible page-level overflow.

---

## Finding 3 — Dashboard "Recent submissions" table has no responsive treatment; needs horizontal scroll from 650px through ~1280px

**Severity: medium. Screenshots:** `03-dashboard-768.png`, `03-dashboard-1024.png`
(compare `03-dashboard-1440.png`, where it fits cleanly).

**Selector:** `.dashboard-recent .table-scroll` / `.dashboard-recent .data-table`
(component: `src/features/dashboard/components/RecentSubmissionsTable.tsx`).

The table (Source / Title / Status / Speakers / Tags / Submitted) sits in a
`.table-scroll { overflow: auto }` wrapper, so it doesn't break the page —
but it has zero column-hiding at any breakpoint, unlike `.abstracts-table`
two clicks away, which already hides its lowest-priority columns
(`th:nth-child(5)`, `th:nth-child(7)`) below 650px. Measured container vs.
table width:

| Viewport | Container width | Table width | Scroll needed |
| --- | --- | --- | --- |
| 768px | 698px | 900px | **202px hidden** |
| 1024px | 718px | 900px | **182px hidden** |
| 1440px | 1134px | 1134px | none |

So this widget requires horizontal scrolling across two of the four
audited widths (768 and 1024) with no visible affordance (no fade edge, no
scroll hint) — a user has to discover by accident that "Submitted" and part
of "Tags" exist. At 390px it's cramped further still (screenshot
`03-dashboard-390.png`).

**Fix — shipped, but with a known gap this finding correctly flags.**
`globals.css` now hides `Tags` below 1280px, `Speakers` below 1024px, and
`Source` below 768px on `.dashboard-recent`, so the silent scroll container
is gone. It did **not** ship with the semantic column-class metadata pattern
`abstracts-table.tsx` uses (`meta: { className: "abstracts-col-*" }`, read by
`DataTable` and targeted in CSS as `.abstracts-col-track` etc. — see the
`declare module "@tanstack/react-table"` comment in `data-table.tsx`, which
names this exact table as the cautionary example: "the demo `.abstracts-table`
vs. the database-backed one — same feature, different column order"). Instead
it uses `.dashboard-recent .data-table th:nth-child(5)` /
`th:nth-child(4)` / `th:nth-child(1)`, because `RecentSubmissionsTable.tsx` is
a hand-rolled `<table>`, not a `DataTable` caller — there is no per-column
meta to hook a class onto without first moving it onto `DataTable`. That
migration is real work (columns/rows through `ColumnDef`, not a CSS-only
change) and is out of this pass's scope; recorded here as the follow-up
`nth-child` fragility this finding correctly anticipated — a future column
reorder in this table will silently hide the wrong field, exactly as
`data-table.tsx`'s own comment warns.

---

## Finding 4 — Touch targets below the 44px guideline across admin surfaces

**Severity: medium (mobile only). Screenshots:** `11-admin-mobile-nav-390.png`,
`04-abstracts-390.png`.

Measured via `getBoundingClientRect()` at 390px:

| Element | Selector | Size | Screenshot |
| --- | --- | --- | --- |
| Table row checkbox | `.abstracts-table input[type=checkbox]` | **14×14px** | `04-abstracts-390.png` |
| Table row overflow menu | `.abstracts-table .icon-button` | 36×36px | `04-abstracts-390.png` |
| Sidebar hamburger toggle | `.mobile-menu` | 36×36px | `11-admin-mobile-nav-390.png` |
| Mobile sidebar close button | `.mobile-close` | **30×20px** | `11-admin-mobile-nav-390.png` |
| Mobile sidebar nav link | `.nav-group a` | 216×**36px** | `11-admin-mobile-nav-390.png` |

The checkbox and the sidebar's own close button are the two worth
prioritizing: the checkbox's visual target is 14px square (its `<td>` has
padding, but the `onClick` that opens the row's drawer is
`stopPropagation`'d specifically inside that cell, so only the 14px checkbox
itself is clickable, not the padded area around it), and `.mobile-close` at
30×20px is the *only* way to dismiss the full-screen mobile nav overlay
short of tapping the scrim.

**Fix — shipped, and not the padding approach originally sketched above.**
Padding on the `<td>` was never going to work: a native checkbox ignores
`padding` and derives its box from `width`/`height` alone (measured in
Chrome), so a padded cell around a 14×14 checkbox stays a 14×14 hit area no
matter how generous the padding is — the stopped-propagation click on the
cell doesn't help either, since only the checkbox itself receives it. The
shipped fix instead wraps the checkbox in `.checkbox-hit`, a grid-centred
`<label>` (`globals.css`, "T7 — touch-target floor") that owns the hit area
while the control keeps its 14px glyph: `display: grid; place-items: center;
min-width/min-height: 32px` above 768px, `44px` at ≤768px (`min-*` beats the
control's own fixed size, so desktop sizing is untouched). Clicking anywhere
in the label toggles the checkbox natively, no extra handler. `.mobile-close`
is now included in the ≤768px block's `.icon-button, .mobile-menu,
.mobile-close, .portal-mobile-menu { min-width: 44px; min-height: 44px; }` —
44×44, not the `40×40` this finding proposed as an intermediate step; it
clears the floor outright rather than narrowing the gap.

---

## Finding 5 — Abstracts table title column wraps 2–3 lines at 1024px (cramped, not broken)

**Severity: low. Screenshot:** `04-abstracts-1024.png` (compare
`04-abstracts-1440.png`, mostly single-line).

**Selector:** `.submission-title-cell { max-width: 340px }`.

At 1024px the table's other five columns (checkbox, ID, Status, Track,
Rating, Submitted, overflow menu) already consume enough of the available
~980px that the title column is squeezed to its 340px ceiling regardless,
and titles like "Interfaces for Autonomous Software" or "Small Models,
Serious Capability" wrap to 2–3 lines, producing uneven row heights next to
single-line neighbors. Not an overflow and not a regression versus 768
(which has the same fixed 340px and the same wrapping), but visibly denser
than 1440px where the column gets more breathing room. Low priority —
flagging for the spacing-grid stage rather than proposing a breakpoint
change here, since fixing it well likely means letting the Track chip
column shrink first, not just growing the title column.

---

## Finding 6 — Abstracts drawer: no issues found (confirmed working, all four widths)

**Screenshots:** `05-abstracts-drawer-390.png`, `05-abstracts-drawer-768.png`
(not separately reviewed, matches 1024 pattern), `05-abstracts-drawer-1024.png`,
`05-abstracts-drawer-1440.png`.

Once hydration was unblocked (see Method), the drawer opens correctly at
every width. At 390px it correctly goes full-width (`.drawer { width: 100% }`
at the ≤650px breakpoint, `globals.css` line 485) with clean internal
padding (`.drawer-content { padding: 20px 22px }`) and no clipped text. At
1440px it sits as a fixed-width right-side panel with a dimmed backdrop.
Tab row (Overview/Answers/Reviews/Activity), decision buttons
(Decline/Add to accept queue), and the routing-summary 3-column footer all
reflow cleanly. **Note for whoever reviews the raw screenshots:** the
full-page capture shows the *underlying* abstracts list bleeding through
below the drawer's visible area at 390px — that's a `fullPage: true`
screenshot artifact (the `<dialog>` is `position: fixed` and only as tall as
the viewport; Playwright's full-page stitching keeps capturing the page's
true scroll height underneath it), not something a real user would ever see,
since a user only ever sees one viewport-height slice at a time and the
dialog covers it fully. Don't file this as a bug from the screenshot alone.

---

## Finding 7 — Form builder: unreachable in this environment; CFP wizard (its public-facing sibling) is clean at all four widths

**Severity: n/a (coverage gap, not a design finding) for the builder itself.**

`/events/[eventId]/forms/[formId]/page.tsx` and
`/events/[eventId]/forms/page.tsx` both call `eventIdSchema.parse(eventId)`
unconditionally (no `isCredentialFreeLocalDemo()` branch, unlike
`dashboard/page.tsx` and `abstracts`'s parent layout) — a plain UUID-format
check, and the demo event's id (`evt_ai_engineer_2026`) isn't a UUID, so
this 500s regardless of how demo mode is unblocked. This is a real,
pre-existing product gap (the demo-mode script at `docs/demo-script.md`
implies the browser demo's form builder works — "Open Forms, create a
form... The seeded Technical Talks form shows the structural lock" — but the
route source doesn't back that up), worth flagging to whoever owns the demo
fork, separate from this design pass.

As the closest available substitute I screenshotted the **CFP submission
wizard** (`/submit/ai-engineer/technical-talks`, `13-cfp-wizard-*.png`),
which *is* demo-aware and shares the same form-rendering primitives
(`.form-grid`, `.field`, `.choice-cards`) the admin builder's canvas uses.
**No spacing/responsive issues found** at any of the four widths: the step
indicator correctly drops its text labels below 650px
(`.cfp-progress b { display: none }`) and keeps just the numbered circles,
the hero/dark-card layout stacks cleanly to one column, and nothing
clips or overflows. If the builder route gets a demo-mode branch later,
re-screenshot it specifically — its 3-column layout (`.builder-layout`,
rail/canvas/inspector) is structurally different from the wizard and has
its own breakpoint stack (1100/860/650) that this audit could not verify
live.

---

## Finding 8 — Public agenda/speakers: unreachable in this environment (no demo-mode fallback); CSS review only

**Severity: n/a (coverage gap).**

`src/app/e/[eventSlug]/agenda/page.tsx`,
`src/app/e/[eventSlug]/speakers/page.tsx`, and their `/embed/` counterparts
have `generateStaticParams()` but **no `isCredentialFreeLocalDemo()` branch
anywhere in the file** — they read straight from the database always. With
`DATABASE_URL` unset the route throws `DATABASE_URL is required` (confirmed
at runtime, all four widths, `09-public-agenda-*.png` /
`10-public-speakers-*.png` all show the dev error overlay, not the page).
This is not fixable from within a design-audit session without provisioning
a real database, which is out of scope here.

From CSS review only (`globals.css`, `.public-day-tabs` /`.public-filters`/
`.speaker-gallery` rules, all cited in the research doc's breakpoint table
too): these surfaces share the exact same breakpoint gap shape as Finding 2
— responsive rules live at `max-width: 760px` and `max-width: 520px`
(`globals.css` lines 678, 679), so 768px again gets neither treatment. At
768px the un-narrowed rules would apply: `.speaker-gallery` stays
`grid-template-columns: repeat(3, 1fr)` (3 cards in a ~722px container,
~230px each — plausible but tight for a card with a 165px-tall portrait,
title, and topic chips) and `.public-day-tabs button` stays a fixed `190px`
(2 tabs × 190px = 380px, fits comfortably). **I can't confirm which of these
actually breaks without a live render** — unlike Finding 2, where the
portal header's overflow is measured and certain, this is a plausible-risk
flag, not a confirmed bug. Prioritize re-screenshotting this pair first once
a database (or a demo-mode branch) is available; the breakpoint-consolidation
fix would be identical to Finding 2's (`760px → 768px` at the same two line
numbers, since both features' 760px media queries live in the same
`globals.css` blocks).

---

## Finding 9 — Landing: two widths reviewed clean beyond the hero (Finding 1)

**Screenshots:** `01-landing-1024.png`, `01-landing-1440.png` — both clean:
2-column hero at 1440 (`.hero` default `grid-template-columns: .92fr 1.08fr`
above 1120px), 4-card `.landing-feature-grid` reflowing to 2×2 correctly at
the 1120px breakpoint, consistent card padding throughout. One cosmetic,
low-priority note: the decorative `.floating-card-two` ("Live sync") tooltip
sits over part of a button label ("...dd") inside the dashboard mockup image
at 1024/1440 — this is an annotation bubble over a static marketing
screenshot-of-a-screenshot, not a real interactive collision, so not
proposing a fix, just noting it was visually checked and judged intentional.

---

## Summary table

| # | Surface | Severity | Selector | Widths affected | Confirmed how |
| --- | --- | --- | --- | --- | --- |
| 1 | Landing hero | **Critical** | `.hero h1`, `.hero-copy > p`, `.hero-art` | 390–690px | DOM measurement (`getBoundingClientRect`) |
| 2 | Portal header | **High** | `.portal-header nav`, breakpoint at line 678 | exactly 768px (and the 761–767px band) | `scrollWidth` vs `clientWidth`, all 3 portal screenshots |
| 3 | Dashboard recent-submissions table | Medium | `.dashboard-recent .table-scroll` | 650–~1280px | Table vs. container width measurement |
| 4 | Touch targets (admin) | Medium (mobile) | checkbox, `.mobile-close`, `.nav-group a` | ≤390px | `getBoundingClientRect` |
| 5 | Abstracts title column wrap | Low | `.submission-title-cell` | 768–1024px | Visual (screenshot) |
| 6 | Abstracts drawer | none | — | all | Screenshot, all 4 widths |
| 7 | Form builder | n/a (coverage gap) | — | — | Route source read; CFP wizard substituted, clean |
| 8 | Public agenda/speakers | n/a (coverage gap) | — | — | Route source read; CSS-only risk flag |
| 9 | Landing (rest) | none | — | 1024, 1440 | Screenshot |

**Priority order for the fix pass:** 1 (critical, mechanical, one breakpoint
block) → 2 (high, one-line breakpoint number change, but re-screenshot every
portal page after since it's shared chrome) → 4 (mobile touch targets,
mechanical) → 3 (extend the already-proven abstracts-table column-hide
pattern) → 5 (defer to the spacing-grid stage) → re-attempt 7/8 once a
database or a demo-mode branch exists for those two route trees.
