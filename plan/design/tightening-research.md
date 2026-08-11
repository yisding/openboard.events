# Design tightening — research and app-mapped guidance

**Scope:** input to the design-tightening work on the existing Jade + Ice language.
`design-system.md` and `experience-design.md` remain law — this file does not propose
re-theming, new tokens, or undoing today's type-scale raise (the bottom four steps are
now 10 / 11 / 11.5 / 12.5, and that is the floor, not a target). It proposes tightening
*discipline*: fewer effective sizes/weights in practice, a real spacing grid, consistent
breakpoints, and an accent audit — all inside the existing tokens.

Every claim below is either sourced (design-system docs of shipped products, or named
practitioners) or measured directly from this repo's `src/app/globals.css` (1204 lines)
and component tree. Measured claims say "measured" and give the command's result.

> **Status (2026-08-11): this file is research input, not the shipped spec.**
> Where it disagrees with `design-system.md`'s "Tightening pass (2026-08)"
> section, **that section wins** — it is the binding record of what shipped.
> Kept as written so the reasoning is inspectable; three recommendations here
> were deliberately overruled downstream, each for a stated reason:
>
> | This file says | What shipped | Why |
> | --- | --- | --- |
> | §1 "**Do not shrink the step count**" — keep fifteen type steps, fold only the six off-scale leaks onto them | **Eleven steps.** 12, 13, 18 and 48 removed as well | Every removed step had a surviving neighbour within 1px or one tier, and each was doing a job an adjacent step already did. The four *raised* bottom steps (10/11/11.5/12.5) were protected exactly as this file demands — the cuts are all above them. See T1 |
> | §2 "800 stays as-is… do not touch 400/500" | **Three weights: 400, 600, 700.** 500 folded into 600; 800 into 600 or 700 by role | This file's own sources are the argument: Carbon caps emphasis at 600 and omits 700 entirely; Linear resists 700+. Keeping a fifth weight whose only job was uppercase micro-labels — which are already distinguished by size, letter-spacing and caps — spent a weight on a distinction the type was making anyway. See T3 |
> | §5 "**27 sites** to audit for `color: var(--accent)`" | **One** real site | The grep was unanchored and matched `border-color`/`accent-color`. See the correction in §5 |
>
> A fourth item is not a disagreement but a gap: every check this file proposes
> reads *declarations in `globals.css`*. Three of the rules bind **rendered
> pixels**, and the final pass's findings all lived in that gap — an inherited
> UA `small { font-size: .8333em }` putting real text at 8.33px, UA `1em` block
> margins landing off-grid, and `.button`'s 38px height clearing no touch-target
> floor on a phone. None is visible to any grep. See T8's rendered-DOM sweep.

---

## 1. Typographic scale

### What mature products actually ship

- **Atlassian Design System**: 14 total named text styles — 7 headings (XXL 32px down to
  XXS 12px), 3 body sizes (16 / 14 / 12px), 3 "metric" sizes, 1 code style. Three font
  weights only (regular, medium, bold), and bold in body text is flagged explicitly:
  "use this weight sparingly." XXS and Body S are themselves flagged "used sparingly."
  — [atlassian.design/foundations/typography](https://atlassian.design/foundations/typography)
- **GitHub Primer**: 6 base size primitives (0.75rem/12px → 2.5rem/40px) composed into a
  small set of *semantic* styles (Display, Title, Body, Caption) — the primitive count
  stays small; variety comes from combining size+weight+line-height into named roles, not
  from adding more raw sizes.
  — [primer.style/product/primitives/typography](https://primer.style/product/primitives/typography/)
- **IBM Carbon**: a single formula-generated scale, split into two *type sets* —
  "productive" (condensed, task-focused, tight 1.29 line-height) for product surfaces and
  "expressive" (1.40–1.50 line-height) for editorial/marketing — same idea this app
  already encodes as "two densities, deliberately" in `experience-design.md`.
  — [carbondesignsystem.com/elements/typography](https://carbondesignsystem.com/elements/typography/overview/)
- **Linear** (dense B2B product, closest analog to this app): product-surface sizes
  cluster at 12 / 13 / 14 / 16 / 18 / 20 / 22px; display sizes (28–80px) are reserved for
  marketing pages, not the app shell. Body default is 16px, Body SM 14px, Caption 12px.
  — [Linear DESIGN.md via awesome-design-md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- **Minimum body size for dense data UIs**: practitioner consensus (Stéphanie Walter, UX
  researcher specializing in dense/complex UI) is that 10px is legitimate *only* for
  glance content — table headers, tags, badges the user recognizes rather than reads —
  while continuous body/paragraph text below ~12px becomes fatiguing regardless of
  screen quality. 16px remains the "read for a while" baseline; 14–16px is the accepted
  band for dashboard body text specifically.
  — [stephaniewalter.design — minimum font-size for dense data web apps](https://stephaniewalter.design/blog/what-minimum-font-size-for-a-high-density-data-web-app-do-you-suggest/), [datafloq — typography for dashboards](https://datafloq.com/typography-basics-for-data-dashboards/)
- **Modular ratios**: Minor Third (1.2) and Major Third (1.25) are the two ratios cited
  as the safest, most legible choices for text-dense interfaces; this app's scale is not
  a strict geometric progression (it is hand-tuned, which is normal for a dual-density
  product), so ratio conformance is not the useful check here — *step count and role
  discipline* are.
  — [supercharge.design — what is a type scale](https://supercharge.design/blog/what-is-a-type-scale)

### Verdict for this app

The documented 15-step scale (10, 11, 11.5, 12, 12.5, 13, 14, 16, 18, 20, 24, 28, 32, 40,
48) is *not* oversized for a product that spans dense admin table captions and a
marketing hero in the same stylesheet — Atlassian alone needs 14 named styles for a
single-density product; this app deliberately runs two densities. **Do not shrink the
step count.** The problem is not the scale, it is drift off it.

**Measured:** `grep -oE "font-size:\s*[0-9.]+px" src/app/globals.css` returns **23
distinct values in production use**, not 15: 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15,
16, 18, 20, 22, 24, 26, 28, 32, 34, 38, 40, 48, plus 3 and 6 (the two SVG-viewBox
exemptions `design-system.md` already carves out for `.dashboard-donut text`). The eight
**off-scale leaks** are: `10.5`, `15`, `22`, `26`, `34`, `38`, plus a `40` used inline
that's already on-scale, and a bare `18px` count worth re-checking for consistency.

**Concrete, checkable action:** fold every off-scale declaration onto its nearest
documented step, mechanically, the same way the four-step raise was done:
- `10.5px` → `11px` (2 known instances near existing 11px table micro-labels)
- `15px` → `14px` or `16px` depending on which neighbor the rule is visually closer to
- `22px` → `20px` or `24px`
- `26px` → `24px` or `28px`
- `34px` → `32px`
- `38px` → `40px`

No new sizes get added; the fifteen-step scale stays the ceiling. Re-run the grep above
after the sweep — it should return exactly 15 distinct px values (plus the 2 SVG
exemptions) with zero stragglers. Inline `fontSize` styles in components were checked
separately (`grep -rhoE "fontSize:\s*[0-9.]+" src --include=*.tsx`) and are already
on-scale (10, 11, 11.5, 12, 12.5, 20) — no drift there, so the leak is CSS-only.

---

## 2. Font-weight discipline

### What mature products actually ship

- **General practitioner rule**: "more than four weights in a single project usually
  signals a lack of typographic discipline rather than sophisticated design... each
  additional weight should serve a distinct, identifiable purpose." Weight is treated as
  one of the cheapest hierarchy tools *precisely because* it's used sparingly — if
  everything is bold, weight stops signaling anything.
  — [madegooddesigns.com — font weight guide](https://madegooddesigns.com/font-weight-guide/)
- **IBM Carbon**: caps at **three** functional weights for product UI — 300 (display),
  400 (body), 600 (emphasis/UI labels) — and **700 is intentionally absent** from the
  production type scale. Emphasis tops out at 600, full time.
  — [carbondesignsystem.com/elements/typography](https://carbondesignsystem.com/elements/typography/overview/)
- **Linear**: display headlines cap at 600; card titles/buttons/eyebrows use 500; body
  is 400. The DESIGN.md extraction is explicit that Linear "resists 700+ display
  weights."
  — [Linear DESIGN.md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- **Atlassian**: three weights (regular / medium / bold), bold reserved for headings and
  metrics, called out as a "sparingly" weight everywhere else — not a default for
  emphasis.
  — [atlassian.design/foundations/typography](https://atlassian.design/foundations/typography)

The pattern across all three: **the boldest weight in the system is spent on the fewest
rules**, and the "everyday emphasis" job (a value that needs to stand apart from its
label, an active tab, a selected state) is handled by the *middle* weight, not the top
one.

### Verdict for this app

`design-system.md` already documents 5 weights with roles (400/500/600/700/800) — that
part is fine and matches nobody's system exactly but is internally coherent, and the
task brief says this baseline stands. What's checkable is *how much of the UI reaches
for 700/800 versus the mid-weight 600*.

**Measured:** `grep -oE "font-weight:\s*[0-9]+" src/app/globals.css | sort | uniq -c`:

| Weight | Count | Share |
| --- | --- | --- |
| 400 | 5 | 3% |
| 500 | 4 | 3% |
| 600 | 32 | 22% |
| 700 | 62 | 43% |
| 800 | 40 | 28% |

**71% of every weight declaration in the stylesheet is 700 or 800.** For comparison,
`design-system.md`'s own August-dated table records 700 at 38 rules and 800 at 32 rules —
today's counts (62 and 40) show the boldest two weights have grown *further* since that
snapshot, i.e. this is active drift toward bold-everywhere, not a static baseline. In a
system where Carbon caps emphasis at 600 and Linear resists 700+ outside headline-tier
type, a stylesheet where fewer than 1-in-25 declarations use the two lightest weights
(400+500 = 9 of 143, 6%) is exactly the "bold as noise" failure mode the sources warn
about — every table value, every active tab, every stat competes at the same visual
volume as an actual page heading.

**Concrete, checkable action for downstream stages:** for each 700 declaration, ask "is
this competing for the user's *first* glance on the screen (a page h1, the one primary
number in a stat tile, a genuine error/alert), or is it merely *distinguishable from its
neighbor* (a table cell value next to its label, an active tab, a selected list item)?"
Reassign the second category to 600. A reasonable target ratio, informed by Carbon/Linear
(where the boldest weight is reserved, single-digit-percent usage) and Atlassian
(explicit "sparingly" language for bold in body/UI contexts): **shrink 700's share from
43% toward the 600 band** — i.e. 600 becomes the default "this needs to stand out a
little" weight, and 700 is reserved for true page/section-level headings and the single
most important number per screen. 800 stays as-is (uppercase eyebrows/micro-labels are
inherently rare and already the smallest-count role). Do not touch 400/500 — those are
already the minority, correctly.

---

## 3. Spacing systems

### What mature products actually ship

- **Material Design 3**: 4px base grid; named steps xs(4) sm(8) md(16) lg(24) xl(32).
  Density modes shift *component height* in 4px decrements (comfortable −4px, compact
  −8 to −12px) while the underlying spacing grid itself stays fixed — density is a
  height/padding multiplier applied to the same token set, not a second set of numbers.
  — [m3.material.io/foundations/layout/grids-spacing/density](https://m3.material.io/foundations/layout/grids-spacing/density)
- **Atlassian**: 8px base (`space.100`), full scale 0/2/4/6/8/12/16/20/24/32/40/48/64/80,
  banded by use — 0–8px for icon-to-text gaps and table-cell padding, 12–24px for
  component/card internal spacing, 32–80px for page-level layout rhythm. This two-tier
  banding (a micro tier under 8px, a macro tier above it) is the detail worth copying:
  it's not "everything is a multiple of 8," it's "icon gaps get a finer scale, layout
  gets a coarser one."
  — [atlassian.design/foundations/spacing](https://atlassian.design/foundations/spacing)
- **Linear**: 4px base; XXS 4 / XS 8 / SM 12 / MD 16 / LG 24 / XL 32 / XXL 48, with a
  single named jump to 96 reserved for marketing section breaks — i.e. even the
  "generous" surface uses one specific large number, not a spread of nearby ones.
  — [Linear DESIGN.md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- **Cross-system convergence**: Carbon, Fluent and Polaris are all cited as enforcing
  strict token-only spacing (arbitrary pixel requests get rejected back to the nearest
  token) specifically because 8pt-family scales avoid fractional-pixel rendering across
  common display densities.
  — [gridmakerpro.com — 8pt grid](https://gridmakerpro.com/glossary/8pt-grid/)

### Verdict for this app

**Measured:** collecting every `gap:`, `padding:`/`padding-*:`, `margin:`/`margin-*:` px
value in `globals.css` and taking the distinct set returns **53 different pixel
values** (1px to 96px, plus one 236px outlier), including a long run of *odd, off-grid*
numbers with no apparent tier: 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 31, 35, 42,
45, 50, 55, 56, 58, 60, 62, 65, 66, 75, 78, 90. That is roughly five times the vocabulary
Linear or Atlassian ship with,
and — unlike Atlassian's deliberate micro/macro split — there's no visible banding logic;
odd numbers appear at every magnitude, not just under 8px where an icon-gap tier would
justify them.

**Concrete, checkable step scale to adopt** (matches the brief's own suggestion, and
sits between Linear's and Atlassian's actual shipped scales):

- **Micro tier (icon gaps, tight inline spacing, badge/chip padding):** 2, 4, 6, 8
- **Core tier (the vast majority of gaps/padding/margins in admin surfaces):** 12, 16,
  24, 32
- **Macro tier (landing/portal "generous" density only — section rhythm, hero padding):**
  48, 64, 96

That's 10 numbers total across two purposes, replacing 51. Every value outside that list
is a fold-in target for the mechanical sweep, snapping to the nearest tier member — e.g.
`7px`→`8px`, `35px`→`32px`, `45px`→`48px`, `66px`→`64px`, `90px`→`96px`. The one
legitimate exception class, per Atlassian's own spacing doc, is **1–2px optical nudges**
(icon alignment, hairline overlaps) — those don't need to be "on the grid" because
they're not spacing decisions, they're pixel-fitting; don't sweep `1px`/`2px` instances
away, just don't let them multiply into `3px`/`5px`/`7px` near-misses that *do* function
as spacing.

**Density-mode confirmation:** `experience-design.md` already states the two-density
intent (admin compact, portal/public generous) as deliberate, matching Material's model
of one grid with different multipliers rather than two unrelated scales — so the macro
tier above is only a *ceiling* for portal/landing surfaces, not a new admin option. Admin
surfaces should stay inside the micro + core tiers (2 through 32); values at 48+ appearing
in admin CSS (there are several, e.g. `.landing-nav` at 78px height, `.dashboard-*` gaps)
are more likely tier violations than intentional macro-tier use and are worth a specific
second look during the sweep.

---

## 4. Responsive patterns for dense admin UI

### What mature products actually ship

- **Tables → cards on mobile**: the dominant pattern for data-heavy admin surfaces is not
  fitting the full table into a phone width — it's collapsing rows into labeled
  card-stacks, or hiding lower-priority columns first (progressive column disclosure)
  before falling back to cards. Container queries are the modern mechanism for triggering
  this per-component rather than per-viewport.
  — [Setproduct — data table UI design reference 2026](https://www.setproduct.com/blog/data-table-ui-design), search synthesis on admin dashboard responsive trends
- **Mobile-first, but density-aware**: admin/analytics/CRM interfaces are called out
  specifically as "the hardest responsive challenge" because tables and charts don't
  naturally collapse — the fix is deliberate content triage (what's essential at each
  width), not automatic reflow.
- **Scanning patterns**: F/Z-pattern layout guidance still applies to prioritizing what
  survives at narrow widths — put the thing the user scans for first (status, primary
  identifier, primary action) leftmost/topmost so it's what remains after column-hiding.

### Verdict for this app

**Measured:** `grep -oE "@media\s*\(\s*max-width:\s*[0-9]+px\s*\)" src/app/globals.css`
finds breakpoints declared at **11 distinct widths**: 420, 520, 640, 650, 760, 800, 860,
900, 1000, 1100, 1120. (Note: plain `max-width:` as an *element property* — e.g.
`.app-content { max-width: 1510px }` — appears at many more widths and is a separate,
unrelated concern; only the `@media (max-width: …)` breakpoint triggers are counted
here.) That's a wide, ad-hoc set — every feature area (builder, comms, dashboard, CRM,
portal) picked its own numbers rather than sharing a canonical set, which means a
component tested at 768px (a real device width, and one of the four widths this
verification pass uses) can land in a dead zone between two of this app's breakpoints and
behave inconsistently from its neighbors.

**Confirmed-good pattern already in the app, worth preserving as-is:** the
`.abstracts-table` rule at 650px hides lower-priority columns (`th:nth-child(5)`,
`th:nth-child(7)`) rather than trying to cram all columns into a phone width — this is
exactly the progressive-disclosure pattern the sources recommend, and multiple other
tables/lists in the file already convert to card-like `grid-template-columns` reflows
below ~520–650px (e.g. `.admin-task-row`, `.resource-list-admin`). **Don't undo these
during tightening** — audit for *more* places that should adopt the same pattern, not
fewer.

**Concrete, checkable action:** consolidate the 11 breakpoints toward the four widths
this verification pass already tests at — **~480px (phone), ~768px (tablet/sidebar
collapse), ~1024px (three-column → two-column), ~1280px+ (full desktop)** — which also
line up closely with Tailwind/industry-standard breakpoint conventions. Existing
breakpoints within ~40px of a canonical value (520→480, 760→768, 800→768, 900→1024,
1000→1024, 1100/1120→1024) should be merged onto it during the sweep; 420, 640 and 650
are narrow/mid-narrow enough to potentially collapse into each other or map to 480/768
depending on what triggers at each. This is a
lower-priority, higher-risk item than the type/spacing sweeps (breakpoint changes are the
most likely to cause visual regressions) — sequence it after type and spacing are
verified stable, and re-screenshot at 390/768/1024/1440 after any breakpoint
consolidation specifically.

---

## 5. Color restraint

### What mature products actually ship

- **General practitioner target**: "one dominant neutral system, one primary action
  color, one supporting accent, and a small set of semantic colors" — restraint isn't
  about the palette's total token count, it's about every non-neutral color having "a
  clear job" (buttons vs. alerts vs. links vs. backgrounds each own a distinct role, and
  colors don't get reused across roles).
  — [supercharge.design — guide to colors in design systems](https://supercharge.design/blog/a-guide-to-colors-in-design-systems)
- **Gray-first**: starting from grayscale and adding color last is recommended precisely
  so hierarchy has to work without hue before color is layered on — color "sharpens," it
  doesn't "carry."
- **Linear**: brand accent is "restricted to brand mark, primary CTA buttons, focus
  rings, and link emphasis only" — a hard, named allow-list, not a general-purpose
  highlight color. Everything else is the neutral/surface ladder.
  — [Linear DESIGN.md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)

### Verdict for this app

This app's `design-system.md` already states a Linear-equivalent rule — accent is
fills-only via `--accent`, text uses `--accent-dark`, and `experience-design.md`
independently states "one accent, spent only on action and status... scarce color is
trusted color." The research confirms this is the correct, industry-standard shape.
**The finding here is not a rule change — it's a measured compliance gap** worth handing
to the audit stage.

**Measured:** `grep -oE "color:\s*var\(--accent\)[^-]" src/app/globals.css` (bare
`--accent`, excluding `--accent-dark/bright/soft/...`) returns **27 hits** — meaning 27
places set the CSS `color` property directly to the vivid fill-only token, which is the
*text* property. `design-system.md` is explicit that `--accent` "never renders as text on
a light surface" and is only 3.06:1 on white (2.90 on canvas, below the 3:1 non-text
floor, per the doc's own "known deviations" section).

> **Correction (2026-08-11, final verification stage).** The "27 hits" above is
> wrong, and the bug is in the pattern, not the stylesheet. `color:\s*var\(--accent\)`
> is unanchored, so it also matches the tails of **`border-color:`** and
> **`accent-color:`**. Nearly all 27 hits were exactly that — `.tabs
> button.active { border-color: var(--accent) }`, `input[type=checkbox] {
> accent-color: var(--accent) }`, `.template-card:hover { border-color: … }` —
> all correct fill-role uses. Anchoring to the property itself,
> `grep -noE "(^|[;{[:space:]])color:\s*var\(--accent\)[^-a-z]"`, finds **one**
> real violation in the whole file: `.comms-rail button.active`, fixed to
> `--accent-dark`. Everything below in this section still reads correctly as
> *method* — check each site, text takes `--accent-dark`, icons must not sit on
> `--canvas` — only the count was inflated. Left in place rather than rewritten
> so the mistake stays visible: an unanchored grep for a CSS property matches
> every longhand ending in that property.

Not all 27 are necessarily bugs — `color` also drives `currentColor` for inline SVG
icons via `stroke`/`fill: currentColor`, and a few sampled sites (e.g. `.tabs
button.active { border-color: var(--accent) }` paired with a *separate*
`color: var(--accent-dark)` on the same selector) show the pattern already used
correctly nearby. But every one of the 27 is a candidate that needs an eyes-on check:
**is this `color` driving real text, or an icon?** If text: swap to `--accent-dark`. If
an icon: confirm it never sits directly on `--canvas` (the one context the doc's own
deviation note does *not* cover) — icons on `--surface`/white are fine at 3.06:1 for
non-text, icons on `--canvas` at 2.90:1 are not.

**Token-usage tally for context** (`grep -oE -- "--accent[a-z-]*"`): `--accent-dark`
155 uses, `--accent` 61 uses (of which the 27 above are the `color:` subset; the
remaining ~34 are legitimate `background`/`border-color`/`box-shadow` fill uses),
`--accent-soft` 45, `--accent-border` 21, `--accent-faint` 18, `--accent-bright` 12,
`--accent-hover` 3. The text-role token (`--accent-dark`) outnumbering the fill-role
token (`--accent`) 2.5:1 is expected and healthy — text is more common than discrete
fills in any UI — which makes the 27 `color: var(--accent)` sites the actual anomaly to
resolve, not a sign of over-accenting generally. **No new semantic colors and no new
accent budget are indicated by this research; the existing budget is right, it just has
27 sites to audit for correct token choice.**

---

## Summary — what downstream stages should treat as checkable, in priority order

1. **Type-scale fold-in** (low risk, mechanical): collapse `10.5/15/22/26/34/38px` onto
   the nearest of the documented 15 steps. Re-verify with the grep above → should return
   exactly 15 values + 2 SVG exemptions.
2. **Font-weight rebalance** (medium risk, judgment-per-site): audit every `font-weight:
   700` declaration against "is this competing for first glance, or merely
   distinguishable from its neighbor" — move the "merely distinguishable" cases to `600`.
   Target: meaningfully shrink 700's 43% share; 800 and 400/500 stay as documented.
3. **Spacing grid enforcement** (medium risk, mechanical with exceptions): adopt
   micro-tier `2/4/6/8` + core-tier `12/16/24/32` for admin surfaces, macro-tier
   `48/64/96` reserved for portal/landing generous density. Snap the ~40 off-grid values
   found to their nearest tier member; leave `1px`/`2px` optical nudges alone.
4. **Accent-as-text audit** (low risk, 27 sites): resolve each `color: var(--accent)`
   site to `--accent-dark` (text) or confirm-and-leave (icon not on `--canvas`).
5. **Breakpoint consolidation** (highest regression risk — sequence last, verify hardest):
   merge the 11 ad-hoc breakpoints toward 480/768/1024/1280, re-screenshot every affected
   surface at 390/768/1024/1440 after the change specifically, since this is the one
   category most likely to visibly break a layout rather than just shift a token.

## Sources index

- Atlassian Design System — [typography](https://atlassian.design/foundations/typography), [spacing](https://atlassian.design/foundations/spacing)
- GitHub Primer — [typography primitives](https://primer.style/product/primitives/typography/)
- IBM Carbon Design System — [typography overview](https://carbondesignsystem.com/elements/typography/overview/)
- Material Design 3 — [density](https://m3.material.io/foundations/layout/grids-spacing/density)
- Linear design tokens (practitioner extraction) — [DESIGN.md](https://github.com/voltagent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)
- Stéphanie Walter (UX researcher, dense/complex UI specialist) — [minimum font-size for dense data web apps](https://stephaniewalter.design/blog/what-minimum-font-size-for-a-high-density-data-web-app-do-you-suggest/)
- Datafloq — [typography basics for data dashboards](https://datafloq.com/typography-basics-for-data-dashboards/)
- Setproduct — [data table UI design reference 2026](https://www.setproduct.com/blog/data-table-ui-design)
- Supercharge Design — [what is a type scale](https://supercharge.design/blog/what-is-a-type-scale), [guide to colors in design systems](https://supercharge.design/blog/a-guide-to-colors-in-design-systems)
- Made Good Designs — [font weight guide](https://madegooddesigns.com/font-weight-guide/)
- Grid Maker Pro — [8pt grid](https://gridmakerpro.com/glossary/8pt-grid/)

## Measurement commands (for downstream stages to re-run and verify against)

```bash
# distinct font-size values in use
grep -oE "font-size:\s*[0-9.]+px" src/app/globals.css | sed -E 's/font-size:\s*//' | sort -u

# font-weight distribution
grep -oE "font-weight:\s*[0-9]+" src/app/globals.css | sed -E 's/font-weight:\s*//' | sort -n | uniq -c

# distinct spacing (gap/padding/margin) px values
grep -oE "(gap|padding(-[a-z]+)?|margin(-[a-z]+)?):\s*[0-9]+px" src/app/globals.css | sed -E 's/^[a-z-]+:\s*//' | sort -n -u

# breakpoints declared (media-query triggers only, not element max-width properties)
grep -oE "@media\s*\(\s*max-width:\s*[0-9]+px\s*\)" src/app/globals.css | grep -oE "[0-9]+" | sort -n -u

# bare --accent used as text color (candidates for --accent-dark)
grep -noE "color:\s*var\(--accent\)[^-]" src/app/globals.css

# accent-family token usage counts
grep -oE -- "--accent[a-z-]*" src/app/globals.css | sort | uniq -c | sort -rn
```
