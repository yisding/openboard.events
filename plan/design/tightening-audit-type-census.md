# Type census audit — font-size and line-height

**Stage law:** [`tightening-research.md`](tightening-research.md) (§1, Typographic scale).
**Standing law, unchanged by this audit:** [`design-system.md`](design-system.md) §Size
(fifteen-step scale: 10, 11, 11.5, 12, 12.5, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48;
base 14px) and §Weight. This document does not propose new tokens or a re-theme — it is
a census: what's actually declared today, which declarations are off the documented
scale, and a proposed mechanical fold-in for the next execution stage.

Scope: `src/app/globals.css` (1204 lines, mixed human-formatted + minified sections) and
every inline `fontSize`/`lineHeight` style under `src/**/*.tsx`.

> **Status (2026-08-11): historical census, taken *before* the sweep.** Every
> count below describes the pre-sweep stylesheet and none of it is current. The
> binding record of what shipped is `design-system.md` → **T1** (eleven steps,
> not the fifteen named in the header above) and **T2** (five line-heights).
> Two of this file's conclusions carried through and are worth keeping visible:
> the `clamp()` blind spot it found was real and was resolved its recommended
> way — one shared formula for both brand headlines, `clamp(40px, 5vw, 72px)`,
> a 40px floor rather than the 48px this file suggested (T1 exemption 2 gives
> the reason) — and its warning not to "let a mechanical grep-based
> re-verification pass silently declare victory while these two `clamp()` rules
> sit unexamined" generalised further than it knew: see T8 on why the greps are
> necessary but not sufficient.

---

## 1. Font-size census — `globals.css`

### 1a. Plain `NNpx` declarations (what the research file's grep already caught)

```
grep -oE "font-size:\s*[0-9.]+px" src/app/globals.css | sed -E 's/font-size:\s*//' | sort -n | uniq -c
```

| Size | Count | Status |
| ---: | ---: | --- |
| 3px | 1 | exempt (`.dashboard-donut text`, SVG user units) |
| 6px | 1 | exempt (`.dashboard-donut text`, SVG user units) |
| **10px** | **218** | on scale |
| 10.5px | 1 | **off-scale leak** |
| **11px** | **151** | on scale |
| **11.5px** | **87** | on scale |
| **12px** | **34** | on scale |
| **12.5px** | **60** | on scale |
| **13px** | **19** | on scale |
| **14px** | **15** | on scale |
| 15px | 2 | **off-scale leak** |
| **16px** | **9** | on scale |
| **18px** | **9** | on scale |
| **20px** | **12** | on scale |
| 22px | 2 | **off-scale leak** |
| **24px** | **12** | on scale |
| 26px | 1 | **off-scale leak** |
| **28px** | **8** | on scale |
| **32px** | **11** | on scale |
| 34px | 1 | **off-scale leak** |
| 38px | 1 | **off-scale leak** |
| **40px** | **5** | on scale |
| **48px** | **1** | on scale |

Total: 661 `NNpx` rule-instances, 23 distinct values (matches the research file's own
count exactly) — 15 documented steps present and correctly used 653 times, 2 SVG-exempt
values used twice, and **6 distinct off-scale values used 8 times**: `10.5` (×1), `15`
(×2), `22` (×2), `26` (×1), `34` (×1), `38` (×1). No step is missing from the codebase —
all fifteen documented sizes are in active use — so this is purely a drift/leak problem,
not a gap in the scale.

One more literal value the plain-`px` grep also catches but that isn't a reading size at
all: **`font-size:0`** (1 instance, line 679 inside the `max-width:520px` media block) —
`.agenda-view-tabs button{font-size:0}` paired with `.agenda-view-tabs button svg{display:block}`.
This is the standard "collapse the text node, keep the icon" technique for an icon-only
button on narrow screens. It's not a scale violation and needs no fold-in; flagging it so
downstream sweeps don't mistake it for a stray value.

### 1b. `clamp()` declarations — a blind spot the existing census misses entirely

The research file's own re-run command (`grep -oE "font-size:\s*[0-9.]+px"`) requires a
literal `NNpx` immediately after `font-size:`. It silently skips both of the following,
because the token after `font-size:` is `clamp(`, not a digit:

```
161:  .hero h1 { font-size: clamp(48px, 5vw, 71px); line-height: .99; ... }
1166: .login-brand-panel h1{...font-size:clamp(42px,5vw,70px);line-height:1;...}
```

These are real, shipped `font-size` declarations carrying **four more px values that
never appeared in any prior census**: 42, 48 (already a documented step, so not new),
70, 71. Both rules power a full-bleed marketing/brand headline (`.hero h1` on the public
landing page, `.login-brand-panel h1` on the sign-in screen) that fluidly scales with
viewport width between a floor and a ceiling.

**Why this matters at the verification widths this stage already screenshots:**
- `.hero h1`: `5vw` reaches its 71px ceiling once the viewport exceeds ~1420px — so at
  1440px (one of the four required screenshot widths) this heading renders at a flat
  **71px**, 48% past the documented 48px scale ceiling that `design-system.md` itself
  cites as the example top step ("the same family sets 8px table labels and a 48px
  hero" — design-system.md line 183).
- `.login-brand-panel h1`: ceiling of 70px is reached above ~1400px — same story, one
  px short of the landing hero's ceiling for no evident reason.
- Both rules already have a *mobile* override that lands cleanly on-scale: `.hero h1`
  drops to a flat `40px` under `max-width:650px` (line 538); `.login-brand-panel h1`'s
  parent is hidden entirely under `max-width:760px` (the brand panel collapses to a
  compact bar). So the off-scale behavior is specifically a **desktop-only** condition —
  exactly the width this stage's 1440px screenshot pass will observe it at.

**Near-duplicate finding:** these two clamp formulas do the *same job* (full-bleed brand
headline, one on the landing page, one on the sign-in screen) with bounds that drifted
apart for no documented reason: `48/71` vs `42/70`. The 1px gap between the two ceilings
(71 vs 70) is pure noise; the 6px gap between the two floors (48 vs 42) is a real,
visible difference between two headlines that should plausibly read as the same "brand
display" size. Whichever bounds are chosen, both rules should share one formula.

**This is a policy question, not a mechanical fold, and should be flagged to the
downstream execution stage explicitly:** the fifteen-step scale's ceiling is 48px, but
these two rules were evidently authored to intentionally exceed it for hero-tier display
type (matching the research file's own citation of Linear: "display sizes (28–80px) are
reserved for marketing pages, not the app shell"). Two honest options:
1. **Formalize a third exemption** alongside the existing SVG-donut carve-out:
   "full-bleed marketing/brand `<h1>` may use a `clamp()` display size above the 48px
   scale ceiling, bounded by one shared formula" — then unify both rules to identical
   bounds (e.g. `clamp(48px, 5vw, 72px)`, keeping the floor on-scale and picking one
   clean ceiling instead of two near-identical ones).
2. **Cap both at the documented 48px ceiling** (`clamp(40px, 5vw, 48px)` or similar),
   which brings them inside the law but visibly shrinks both heroes on wide monitors —
   a real visual regression that needs sign-off, not a silent sweep.
Recommend (1): it matches the scale's own stated intent (48px cited as *a* hero example,
not a hard ceiling for all display type) and avoids a visible shrink. Either way, do not
let a mechanical grep-based re-verification pass silently declare victory while these two
`clamp()` rules sit unexamined — they were invisible to the check in the first place.

### 1c. Inline `fontSize` in components — confirmed clean

```
grep -rhoE "fontSize:\s*[0-9.]+" src --include=*.tsx | sed -E 's/fontSize:\s*//' | sort -n | uniq -c
```

| Size | Count |
| ---: | ---: |
| 10 | 4 |
| 11 | 11 |
| 11.5 | 12 |
| 12 | 1 |
| 12.5 | 6 |
| 20 | 1 |

35 total, all on the documented scale, spread across 16 files (`rich-primitives.tsx`,
`tasks-admin-view.tsx`, `task-matrix-drawer.tsx`, `files-admin-view.tsx`,
`success-page-card.tsx`, `settings-step.tsx`, `notifications-step.tsx`,
`close-date-card.tsx`, `event-switcher.tsx`, `segments-view.tsx`, `pipeline-board.tsx`,
`directory-view.tsx`, `crm-bulk-email-dialog.tsx`, `contact-detail-view.tsx`,
`billing-panel.tsx`, `session-form-dialog.tsx`). No fold-in needed here — this confirms
the research file's finding and this audit found no additional inline pattern (no
`rem`/`em`/template-literal font-size, no `font:` shorthand with a size, no Tailwind
`text-*` utility classes in use anywhere in `src`).

---

## 2. Proposed consolidated font-size mapping

Per-instance fold targets, chosen by looking at each rule's actual neighbors (sibling
declarations in the same component) rather than picking the numerically nearer step by
default — the research file flagged `15px` as ambiguous ("14 or 16 depending on which
neighbor the rule is visually closer to") and the same ambiguity applies to `22`, `26`,
and `10.5`. Both occurrences of a given off-scale value are listed separately where their
roles differ.

| File / selector | Current | Sibling context | Proposed | Why |
| --- | ---: | --- | ---: | --- |
| `.command-palette-results button small` | 10.5px | primary row text is 12.5px | **11px** | Keeps the 1.5px drop from the 12.5px primary label tighter (vs a 2.5px drop to 10px); this is a meta/secondary line, same role as the many other `small` secondary-line labels already on 11px elsewhere in the file. |
| `.landing-feature-grid h3` | 15px | sibling `p` is 12.5px | **14px** | Card-heading role; every other "small card heading" in the codebase (`resource-tip h3`, `speaker-gallery h3`, `mini-public h3`, `itinerary-day h3`) already sits at 14px. Folding here restores that pattern instead of breaking it. |
| `.share-talk-title` (speaker-share-page.tsx) | 15px | h1 above is 26px→28px (see below), footer below is 11.5px | **16px** | This is the card's subtitle/secondary headline, not a small caption — it needs more presence than a 14px card-heading role. Judgment call; 14px is defensible too if the goal is minimal visual change. |
| `.portal-hero h2` (portal home hero banner) | 22px | eyebrow above is 11px, `p` below is 12.5px | **24px** | `.portal-hero` is a generous-density portal surface; its sibling gradient-hero pattern `.welcome-card h2` (CFP wizard) is already 24px. The 20px tier (`.drawer-hero h2`, `.speaker-drawer-hero h2`) belongs to dense *admin drawers*, a different density context — don't collapse a portal hero onto an admin-drawer size. |
| `.speaker-detail-hero h2` (public-speaker-gallery.tsx) | 22px | `p` below is 11.5px | **24px** | Same reasoning — this is a public/portal-facing detail-page hero, not an admin drawer. |
| `.share-card h1` (speaker-share-page.tsx) | 26px | subtitle below is 15px→16px | **28px** | Poster-style share-card headline; matches the app's existing "page-title" tier (`.page-header h1`, `.cfp-step > h1`, `.landing-section-head h2` are all already 28px). Equidistant from 24/28 numerically, but role-wise this reads as a headline, not a subheading. |
| `.share-headshot-fallback` (avatar-initials glyph in a 128px circle) | 34px | — | **32px** | Not running text — an avatar-initials glyph. 32px is 2px away vs 40px being 6px away; no reason to jump a full tier for a glyph that scales with a fixed 128px container. |
| `.login-form-panel form h1` (desktop tier) | 38px | same selector already has a `@media(max-width:760px)` override to **32px** | **40px** | Closes a two-tier desktop/mobile pair that's *already* correctly on-scale on the mobile side (32px) — folding the desktop value to 40px gives the pair a clean 40/32 relationship instead of an off-scale 38/32 one. |

Net effect: 6 distinct off-scale values, 8 rule-instances, all resolved without adding
any new size — every proposed target is one of the fifteen documented steps. Re-running
`tightening-research.md`'s verification grep after this fold-in should return **exactly
the fifteen documented values plus the two SVG-exempt values (3px, 6px)** — 17 distinct
`NNpx` results, down from 23 today. The `font-size:0` icon-collapse rule and the two
`clamp()` rules are outside that grep's pattern by construction and need the separate
handling described in §1a and §1b above.

---

## 3. Line-height census — `globals.css`

**This scale has no governing law today.** Unlike font-size and font-weight, neither
`design-system.md` nor `experience-design.md` documents a line-height step count or
role table. `tightening-research.md` doesn't carry a dedicated line-height section
either — this census is the first count taken. Findings below use the same "step count
discipline" lens the research file applies elsewhere, but the specific consolidated
values are this audit's proposal, not a re-statement of existing law.

```
grep -oE "line-height:\s*[0-9.]+[a-z%]*" src/app/globals.css | sed -E 's/line-height:\s*//' | sort | uniq -c
```

68 unitless declarations across 17 distinct values, plus one absolute-pixel outlier
(`33px`) — 69 `line-height` rule-instances total. Sorted by cluster:

| Cluster | Values (count) | Rules | Share |
| --- | --- | ---: | ---: |
| **Tight / display** | `.95`(1) `.99`(1) `1`(2) `1.06`(1) `1.08`(1) | 6 | 9% |
| **Compact / label-heading** | `1.2`(1) `1.25`(3) `1.3`(3) | 7 | 10% |
| **Standard body** | `1.35`(6) `1.4`(3) `1.45`(4) | 13 | 19% |
| **Relaxed body** (largest bucket) | `1.5`(12) `1.55`(11) `1.6`(10) | 33 | 49% |
| **Loose / expressive** | `1.65`(6) `1.7`(1) | 7 | 10% |
| **Outlier** | `2`(1) | 1 | 1% |
| **Absolute-px outlier** | `33px`(1, paired with `font-size:18px`) | 1 | — |

**The relaxed-body cluster alone is 49% of every line-height declaration in the
stylesheet, split across three values within 0.1 of each other** (`1.5`/`1.55`/`1.6`) —
this is the single largest proliferation in either census, larger in proportion than any
font-size leak. It reads exactly like unintentional drift: three near-identical numbers
doing the same "comfortable paragraph" job because there was never a named step to reach
for consistently.

### Context sampled for the tight-display cluster (why five near-1 values, not one)

| Selector | font-size | line-height |
| --- | ---: | ---: |
| `.public-event-hero h1` | 48px | .95 |
| `.hero h1` (clamp 48–71px) | fluid | .99 |
| `.eyebrow`, `.page-eyebrow` | 12.5px | 1 |
| `.login-brand-panel h1` (clamp 42–70px) | fluid | 1 |
| `.public-schedule/.public-speakers > header h2` | 40px | 1.06 |
| `.welcome-copy h1` (CFP welcome) | 40px | 1.08 |

Five different marketing/brand `<h1>`/`<h2>` rules, each independently hand-tuned to
somewhere between .95 and 1.08 — a spread of 0.13, imperceptible at these font sizes on
a single line but proof none of these were set from a shared value. The `.eyebrow` case
(`line-height:1` at 12.5px) is a different role entirely — a single-line uppercase pill
label, where `1` is the standard technique to remove line-box padding, not a "display
heading" choice. Worth keeping that role separate from the big-heading tight cluster even
though both use the literal value `1`.

### Context sampled for the compact cluster

`.page-header h1` (28px) → 1.2; `.calendar-session>b` (10px), `.portal-submission-detail
header h1` (24px), `.mini-public h3` (14px) → 1.25; `.drawer-hero h2` (20px),
`.rich-text-editor__surface h1/h2/h3`, `.dv-session-card>b` (10px) → 1.3. No consistent
correlation with font-size — a 10px chip label and a 28px page heading both landed in
this same 1.2–1.3 band, which suggests the three values aren't actually serving different
roles, just drifted from one intended "compact heading/UI-label" step.

---

## 4. Proposed consolidated line-height mapping

Five steps, matching the font-size fold-in's spirit ("fewer effective values, chosen from
what's already dominant" rather than an imported ratio system) and echoing the research
file's own citation of IBM Carbon's two-density line-height model:

| Step | Value | Replaces | Rule-instances affected | Role |
| --- | ---: | --- | ---: | --- |
| Tight | **1** | `.95, .99, 1, 1.06, 1.08` | 6 | Single/near-single-line display headlines (hero `<h1>`, brand headline, big section `<h2>`) |
| Compact | **1.25** | `1.2, 1.25, 1.3` | 7 | Compact headings and small UI labels/chips that still need a touch of vertical room |
| Standard | **1.4** | `1.35, 1.4, 1.45` | 13 | Default body/caption text in dense (admin) surfaces |
| Relaxed | **1.5** | `1.5, 1.55, 1.6` | 33 | Default body text in generous (portal/landing) surfaces — by far the most common role, so it gets the cleanest, most-conventional number |
| Loose | **1.65** | `1.65, 1.7`, and the `2` outlier | 8 | Long-form/marketing paragraph copy and list content that wants extra breathing room |

This drops 17 distinct unitless values to 5 — a bigger proportional cut than the
font-size sweep (23→17) makes to its own census, which is appropriate: font-size drift
was mostly small (6 stray values), line-height drift is the dominant proliferation this
audit found.

**Two items need judgment, not a mechanical fold:**
- **`2` (`.resource-tip ul`, font-size 11px, a bulleted tip list)** — the sole
  representative of its value, no peer to confirm intent. Folding to 1.65 is the
  mechanical answer; keep an eyes-on check that a bulleted list inside a narrow card
  doesn't specifically need looser spacing than paragraph text for scanability before
  applying it.
- **`line-height:33px` on `.session-date strong` (font-size 18px)** — this is not a
  reading line-height at all. It's a vertical-centering hack: the parent
  `.session-date` box is a fixed `45px`-wide, `53px`-tall date badge, and `33px` makes
  the `18px` day-number text sit centered inside it. Converting it to any unitless ratio
  from the table above (closest available step, 1.65, would render `29.7px` — visually
  different centering) risks a visible regression in that one badge. Recommend the
  downstream sweep either (a) replace the pixel line-height with `display:flex;
  align-items:center` on the parent and drop `line-height` from the child entirely
  (the more correct fix — box-fit centering shouldn't ride on font metrics), or (b)
  leave this one declaration as a documented, named exception the same way the SVG-donut
  `3px`/`6px` are — but don't silently fold it into the unitless scale as if it were a
  reading line-height, because it isn't one.

**Recommend documenting this scale once locked in.** `design-system.md` currently has a
`### Size` and a `### Weight` subsection under Typography but no `### Line-height`
subsection — this is the gap this audit surfaces. Once a downstream execution stage
finishes the fold-in above, add a fifth `design-system.md` subsection recording the five
steps and their roles, the same way Size and Weight are recorded today, so the next
audit has a documented target to re-verify against instead of measuring from zero again.

### Inline `lineHeight` in components — confirmed clean

```
grep -rnoE "lineHeight:\s*['\"]?[0-9.]+['\"]?" src --include=*.tsx
```

3 instances, all `lineHeight: 1.5` (`close-date-card.tsx`, `notifications-step.tsx`,
`settings-step.tsx`) — already sitting on the proposed "Relaxed" step. No fold-in needed.

---

## 5. Summary for the downstream execution stage

1. **Font-size fold-in (mechanical, 8 rule-instances):** apply the §2 table. Re-verify
   with the research file's grep command — expect 17 distinct values (15 steps + 2 SVG
   exemptions), down from 23.
2. **`clamp()` hero headlines (policy decision, 2 rules):** `.hero h1` and
   `.login-brand-panel h1` both exceed the documented 48px ceiling on desktop widths
   (71px / 70px respectively) and were invisible to every prior census because of the
   `clamp()` syntax. Get an explicit call on whether display-tier marketing headlines
   are allowed above 48px (recommended: yes, as a named third exemption, with both
   rules unified to one shared clamp formula) before this stage's 1440px screenshot pass
   is treated as a clean bill of health.
3. **`font-size:0` icon-collapse rule (no action):** confirmed intentional, not a leak.
4. **Line-height consolidation (mechanical + 2 judgment calls, 68 rule-instances):**
   apply the §4 table, five steps. This is a larger proliferation than the font-size
   leak (49% of all line-height declarations sit in a single three-value cluster) and
   currently has zero governing documentation — recommend both fixing the drift and
   adding the missing `design-system.md` subsection in the same pass.
5. **After both sweeps land**, re-run the two census commands from this document and
   confirm: font-size → 17 distinct `NNpx` values + the 2 clamp rules on one shared
   formula; line-height → 5 distinct unitless values + the one documented `33px`
   box-fit exception.

## Measurement commands (for downstream re-verification)

```bash
# distinct font-size px values (misses clamp() by construction — audit those separately)
grep -oE "font-size:\s*[0-9.]+px" src/app/globals.css | sed -E 's/font-size:\s*//' | sort -n | uniq -c

# clamp()-based font-size rules (the blind spot found in this audit)
grep -n "font-size:\s*clamp\|font-size:clamp" src/app/globals.css

# inline fontSize in components
grep -rhoE "fontSize:\s*[0-9.]+" src --include=*.tsx | sed -E 's/fontSize:\s*//' | sort -n | uniq -c

# distinct line-height values (unitless + any unit)
grep -oE "line-height:\s*[0-9.]+[a-z%]*" src/app/globals.css | sed -E 's/line-height:\s*//' | sort | uniq -c

# inline lineHeight in components
grep -rnoE "lineHeight:\s*['\"]?[0-9.]+['\"]?" src --include=*.tsx
```
