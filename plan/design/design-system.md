# Openboard design system

Colour and typography for the admin app, the speaker portal and the public
event pages. All of it lives in `src/app/globals.css`; there is no Tailwind
theme and no design-token package.

The rule this document exists to enforce: **every colour in the stylesheet
resolves to a token in `:root`.** A raw hex in a rule body is a bug unless it
is a gradient stop or white text on a coloured fill.

## Colour

The palette is the **Jade + Ice** system: jade `#00a878` as the brand accent,
deep green-black `#102a2a` as the ink and dark chrome, near-white `#f6faf9`
as the canvas, ice `#cbefff` as a tinted panel surface, and apricot `#ffb86b`
as the warning hue.

The neutral ramp is deliberately green-tinted (hue ≈170, derived from the
ink) so it reads as part of the brand rather than as a separate grey system
sitting next to it. That is why `--ink` is `#102a2a` and not a true black,
and why the borders carry a faint sea-glass cast.

### Surfaces and lines

| Token | Value | Use |
| --- | --- | --- |
| `--surface` | `#ffffff` | cards, inputs, table rows |
| `--surface-raised` | `#fafcfb` | hover states, inset panels |
| `--surface-subtle` | `#eff5f2` | template previews, quiet inset panels |
| `--canvas` | `#f6faf9` | page background |
| `--fill` | `#e9f1ee` | segmented controls, chips, inert fills |
| `--fill-strong` | `#e0eae6` | pressed and selected fills |
| `--line` | `#dde8e4` | default border |
| `--line-strong` | `#cedcd7` | input and control borders |
| `--line-heavy` | `#b4c6c0` | dividers that need to carry weight |

### Text on light surfaces

| Token | Value | On `--surface` | On `--canvas` |
| --- | --- | --- | --- |
| `--ink` | `#102a2a` | 15.14 | 14.39 |
| `--muted` | `#5c706b` | 5.27 | 5.01 |
| `--subtle` | `#778a84` | 3.65 | 3.47 |

`--ink` and `--muted` are the only *neutral* tokens permitted for real text.
There is no third text weight: hierarchy below `--muted` is expressed with
size and weight, not with a lighter grey. (`--accent-dark`, `--accent-bright`
and the semantic foregrounds are also text colours, but only in their
documented roles — links, labels, badges, dark chrome — never as a grey
substitute.)

`--subtle` is **not a text token.** It is for placeholders and decorative
glyphs — content that is duplicated by a visible label and is not required to
operate the interface. It clears the 3:1 bar in WCAG 1.4.11 for non-text
contrast but deliberately does not reach 4.5:1, because a placeholder rendered
at full text contrast is indistinguishable from a filled-in value. Every input
that uses it has a persistent `<label>` via `.field`.

### Dark surfaces

| Token | Value | On `--sidebar` | On `--sidebar-2` |
| --- | --- | --- | --- |
| `--on-dark` | `#e9f4f0` | 13.46 | 12.05 |
| `--on-dark-muted` | `#93aca6` | 6.27 | 5.61 |
| `--on-dark-faint` | `#849f98` | 5.33 | 4.77 |

Surfaces: `--sidebar` `#102a2a` (the palette's deep green-black — the same
value as `--ink`), `--sidebar-2` `#16332f` (raised chrome such as the event
switcher), `--sidebar-line` `#24453f`.

Note that selectors in this file are written flat — `.nav-group a`, not
`.admin-sidebar .nav-group a` — so a tool cannot infer from the CSS alone that
those rules render on a dark surface. If you add a rule inside the sidebar,
pick the `--on-dark-*` token explicitly.

The converse also happens: a rule inside the sidebar may paint its own *light*
background, and its text then needs a dark token. `.sidebar-user > span` is the
one instance — a light jade avatar chip carrying `--accent-dark` initials.
Region membership does not decide the text colour; the nearest painted
background does.

### Brand

Jade is the only accent used for identity, but unlike the old purple it is a
**split accent**: the vivid hex is too luminous to be text (3.06 on white),
so the fill role and the text role are different tokens and must never be
swapped.

| Token | Value | Use |
| --- | --- | --- |
| `--accent` | `#00a878` | vivid fills and indicators only — never text, never under white text (both are 3.06 on white) |
| `--on-accent` | `#102a2a` | the only text colour permitted on `--accent` — 4.96 on it |
| `--accent-hover` | `#00b583` | hover fill for `--on-accent` buttons (hover goes *lighter*; darkening jade drops ink text below AA) — 5.72 |
| `--accent-dark` | `#007454` | jade as text: links, eyebrows, active labels — 5.79 white, 5.50 canvas, 5.01 `--accent-soft`, 5.39 `--accent-faint`, 4.78 `--ice`. Also the fill when white text is required (avatars) — 5.79 |
| `--accent-bright` | `#0fc38f` | brand on dark surfaces — 6.65 `--sidebar`, 5.96 `--sidebar-2` |
| `--accent-border` | `#b7e3d4` | borders on tinted jade. Not a text ground: `--accent-dark` on it is 4.13, so tinted chips use `--accent-soft` |
| `--accent-soft` | `#dff3ec` | tinted background |
| `--accent-faint` | `#eff9f5` | barely-there tint, selected rows |

The rule of thumb: `background: var(--accent)` always pairs with
`color: var(--on-accent)`; `color: var(--accent-dark)` is for text on light
surfaces; on the sidebar and other dark chrome use `--accent-bright`.

How *much* accent a screen may spend — and the one hue it may spend it on — is
[T6](#t6-colour-restraint--the-accent-budget).

Embeds override `--accent` with the event's stored accent colour so fills and
indicators follow the customer's brand. The text side splits by theme: light
embeds derive `--accent-dark` through `accentTextShade()` in
`public-event-shell.tsx`, which darkens any accent below 4.5:1 on white
(compositing alpha over the white ground first), while dark embeds pass the
raw accent through, since a vivid accent is the better text shade on dark
chrome. The embed settings UI itself still accepts any hex without warning
about contrast; the derivation is the safety net.

### Ice

`--ice` `#cbefff` is a tinted panel *surface* — callouts, selected rows,
info panels — never a text colour. It doubles as the blue/info tint
(`--blue-soft` is the same value). Text on ice is `--ink` (12.50),
`--accent-dark` (4.78) or `--blue` (5.31); raw `--accent` glyphs on ice fail
non-text contrast (2.52) and are not permitted. Borders on ice use
`--ice-border` `#a9d8ee`.

### Semantic

Each semantic is a triple: a foreground, a border, and a tinted background.
The foreground is contrast-safe **on both white and its own tint**, because
both pairings occur in the app.

Two triples are deliberately not independent hues. The brand is green and the
secondary accent is orange, so instead of inventing off-hue semantics that
would read wrong, the collisions are embraced: **green aliases the accent
family** (success merges into the brand — a check icon is what still says
"success"), and **amber aliases the apricot family** (`#ffb86b` is the
warning hue; its text shade is `--amber`). The corollary: apricot is not a
free decorative colour. An apricot chip reads as a warning, so charts and
avatars draw from jade, ice, blue and neutrals instead.

The same restraint binds the other two: **green, amber, blue and red may only
appear where they carry a status.** Using one of them to distinguish a
category — which of three task modes, which of four KPI tiles — is a bug, not
a style choice, because it spends the hue that a real warning needs. See
[T6](#t6-colour-restraint--the-accent-budget).

| | Foreground | Border | Background | fg on white | fg on tint |
| --- | --- | --- | --- | --- | --- |
| green (= accent family) | `#007454` | `#b7e3d4` | `#dff3ec` | 5.79 | 5.01 |
| amber (= apricot family) | `#8a5312` | `#f2d8b8` | `#ffe9d2` | 6.31 | 5.36 |
| red | `#af323d` | `#eccccc` | `#fdebed` | 6.28 | 5.46 |
| blue | `#2a6486` | `#a9d8ee` | `#cbefff` (= `--ice`) | 6.43 | 5.31 |

White on the solid semantic fills: green 5.79, red 6.28 — both AA. The vivid
`--apricot` `#ffb86b` fill takes `--ink` text only (8.89); white on apricot
is 1.66 and is never allowed.

### Known deviations

Border tokens do not meet 3:1 against their surrounding surface. WCAG 1.4.11
exempts purely decorative separators, which covers `--line` and
`--sidebar-line`. The arguable case is `--line-strong` on inputs, where the
border is part of the control boundary. This is a deliberate deviation:
raising it to 3:1 makes every form in the product read as heavy and boxed.
The mitigation is that all inputs carry a persistent visible label and a 3px
`--focus-ring`. Revisit if the product ever needs a strict AA conformance
claim.

Second deviation: vivid `--accent` as a non-text indicator directly on
`--canvas` is 2.90 — a hair under the 3:1 UI-component bar (it is 3.06 on
white). This occurs only where an underline or dot sits on the canvas rather
than inside a white panel (e.g. `.abstract-status-tabs`), and in every such
case the indicator is redundant with an `--accent-dark` label that passes at
5.50. Do not introduce an `--accent` indicator on canvas that is the *only*
signal.

**Avatar fills are text grounds, and the seed data is UI.** `.avatar` sets
`color: white`, so every value that reaches it as a background is carrying
text and owes 4.5:1. Nine of the twelve `avatarColor` values in
`src/shared/demo/seed.ts` (and its two copies) sat between 3.22 and 4.43, and
`.avatar-3` itself was a raw `#db715a` at 3.22. Each was darkened in HSL —
hue and saturation held, lightness reduced to the first value clearing 4.55 —
and the third avatar hue is now the `--avatar-3` token. A colour in a seed
file is not exempt from the contrast floor just because it lives in `.ts`
rather than in a rule body; what decides is whether it ends up painted under
text.

**The stylesheet is now hex-free, and closing it moved two tokens.** The 71
raw hexes outside `:root` were not a rename — near-duplicate values collapsed
onto the tokens that already meant what they meant: nine light-surface greys
onto `--ink`/`--muted` (T6's own rule is "text is `--ink` or `--muted`"), eight
accent-family borders onto `--accent-border`, and the rest onto the semantic
and neutral tokens. Two genuinely had no token and got one: `--on-fill` (white
on saturated fills and as the top emphasis step on dark chrome — 24 sites,
plus three spelled `white`, which no hex grep can see) and `--accent-on-dark`
(supporting jade on dark chrome, split from `--accent-bright` for the same
reason `--red-bright` exists).

Collapsing the dark-surface greys is what exposed the real defect: the
`--on-dark` ramp had been verified against `--sidebar` **only**, and the app
paints text on six dark grounds. On the two raised card gradients and on
`--sidebar-line`, `--on-dark-muted` was 4.14–4.35 and `--on-dark-faint` 3.52 —
below the floor, at sites already shipping. `--on-dark-muted` is now `#9db4ae`,
set to clear 4.5:1 on the lightest ground any dark surface reaches. The faint
step could not follow: lightening it to the same floor lands on the muted
value, and a third step equal to the second is not a step, so it is now
documented as valid on `--sidebar`/`--sidebar-2` only, and its one use on a
raised gradient (`.welcome-card > div small`, 3.52) moved up to muted. **A
contrast-verified token is verified against a ground, not in the abstract.**

**A `dialog` resets its own colour, and no grep over this file can see it.**
The abstracts submission drawer is a `<dialog>`, and the UA sheet gives
`dialog` `color: CanvasText` — an origin-level declaration, not an inherited
value, so it wins over everything this stylesheet says about `--ink`. Every
heading, decision button, speaker name and track name in that drawer rendered
pure `#000`. It is not a contrast failure (black on white is 21:1); it is the
app's busiest admin surface silently leaving the palette. `.drawer-shell` now
restates `color: var(--ink)`. This is the same class of defect as `small`'s
inherited `.8333em` ratio in [T1](#t1-type-scale--eleven-steps) and the UA's
`1em` block margins in [T4](#t4-spacing--eleven-steps-in-three-tiers): **the
UA origin is part of the cascade, and only a rendered measurement reads it.**

## Typography

### Typeface

**Archivo**, loaded through `next/font/google` in `src/app/layout.tsx` and
exposed as `--font-sans`.

The stylesheet previously asked for Inter, but Inter was never loaded — there
was no `next/font` call, no `@font-face`, and no font file in `public/`. Every
visitor without Inter installed locally fell through to `ui-sans-serif`.

Archivo was chosen over Inter for three reasons:

1. It carries a **100–900 variable weight axis**. The scale below needs 400,
   600 and 700 to be genuinely distinct, and against a system fallback 600
   collapses onto 700 — a variable face is what keeps the middle step real.
2. It is a grotesque drawn for both text and display, which this app needs:
   the same family sets 10px table labels and a 72px hero.
3. It is not Inter. Inter has become the default signature of this class of
   product; Archivo has more character in the `a`, `g` and `R` without
   costing legibility at small sizes.

`next/font` self-hosts the file at build time, so there is no runtime request
to a font CDN, no CSP entry to maintain, and no layout shift beyond `swap`.
The latin subset is ~35KB.

### Weight

**Three steps: 400, 600, 700.** The stylesheet originally used eleven — 450,
500, 560, 570, 600, 620, 650, 700, 750, 800 and 850 — which a 2026-07 pass cut
to five (400/500/600/700/800). The 2026-08 tightening pass cut it again to
three: 500 was folded into 600 and 800 into 600 or 700 depending on role. See
[Tightening pass → T3](#t3-weight--three-steps) for the binding role rules,
the allow-list and the fold-in mapping.

| Weight | Allowed on | Everything else is a bug |
| --- | --- | --- |
| 400 | running text, helper text, placeholders, any prose | — |
| 600 | the default emphasis weight: buttons, field labels, tabs (active *and* inactive), table headers and values, chips, badges, pills, links, nav, eyebrows, micro-labels, selected/current states | — |
| 700 | reserved, allow-listed: `<h1>`/`<h2>` (and inputs standing in for one), the single primary number in a tile/widget/chart, alert text that also changes colour, the wordmark, and glyph substitutes (avatar initials, marks, rank digits) inside a fixed box | at most 30 declarations in the whole stylesheet |

### Size

**Eleven steps: 10, 11, 11.5, 12.5, 14, 16, 20, 24, 28, 32, 40.**
Base is 14px on `body`, which is right for a dense operations tool.

This replaces the fifteen-step scale (which additionally carried 12, 13, 18 and
48). See [Tightening pass → T1](#t1-type-scale--eleven-steps) for the role of
each step, the exact old→new mapping, and the two exemptions (the shared
display clamp and the SVG donut labels).

The history: 34 authored sizes (one-offs at 23, 25, 27, 29, 31, 34, 35, 43, 44
and 50px) were cut to fifteen; the sub-8px tail (6px and 7px, 53 rules) was
lifted to 8px; then the four lowest steps were raised — 8→10, 9→11, 10→11.5,
11→12.5 — by a mechanical sweep of every `font-size` declaration
(`globals.css`) and inline `fontSize` style (sixteen `builder`, `crm`,
`billing`, `events`, `agenda` and `portal` components carry their caption/help
styles inline rather than as CSS classes). **Those four raised steps are the
floor of the current scale and are not revisited by any later pass** — the
2026-08 tightening removed only steps *above* them (12, 13, 18, 48), none of
the four moved, and nothing in the app lands below 10px.

Three exemptions, listed exhaustively in [T1](#t1-type-scale--eleven-steps):
`.dashboard-donut text`, whose 3px and 6px are SVG user units scaled by a
`viewBox` rather than device pixels; the one shared `clamp()` for full-bleed
brand headlines; and `font-size: 0` as the icon-collapse technique.

Numbers use `font-variant-numeric: tabular-nums` in data tables, stat tiles and
anywhere figures stack vertically.

### Line-height

**Five steps: 1, 1.25, 1.4, 1.5, 1.65.** Unitless only — a `line-height` in px
is a box-fit hack and is a bug. Roles and the fold-in mapping are in
[T2](#t2-line-height--five-steps).

### Open issue: density

**The app was authored at roughly 0.6× conventional UI sizing; the lowest four
steps have since been raised, but the rest of this open issue still stands.**

The floor is no longer 8px (raised to 10px, see above), but the eleven-step
scale itself is still denser than a conventional admin UI, and box dimensions
— heights, padding, gaps, grid columns — were only adjusted where the new
sizes would have clipped, not rebalanced wholesale. A handful of fixed heights
(status pills, table rows, compact selects) were widened just enough to fit
the new sizes without visual regression; that is a targeted fix, not the
coordinated re-scale this section originally called for.

A full coordinated re-scale of type **and** box dimensions, done mechanically,
would still be roughly a uniform ~1.2–1.35× on the component scale on top of
today's values, which also changes how much fits on screen. That remains a
product decision about information density and needs visual QA across every
screen — recommended as a separate piece of work. Until then, treat 10px as
the floor and do not add new rules below it.

The 2026-08 spacing grid ([T4](#t4-spacing--eleven-steps-in-three-tiers)) is a
partial down-payment on that re-scale: because every off-grid value snaps to
the *nearest* tier member with ties resolving upward, the dominant gaps and
paddings move up rather than down (10→12, 14→16, 20→24), which is ~1.2× on the
values that carry most of the layout. Type is deliberately **not** re-scaled in
the same pass; the two would compound and the type side has the harder
regression profile.

## Tightening pass (2026-08)

**This section is binding.** It is the output of the design-tightening stage
and it supersedes any older prose in this document that contradicts it; the
Weight, Size, Line-height and Open-issue subsections above have already been
edited to agree with it.

What it is: fewer effective sizes, weights, spacing values, breakpoints and
hues, inside the existing Jade + Ice language. What it is **not**: a re-theme.
No token is added, renamed or removed. `--accent` stays fills-only, text stays
`--accent-dark`, colour stays token-only, and the 2026-08 type raise (10 / 11 /
11.5 / 12.5 at the bottom) stays the floor.

Its inputs are [`tightening-research.md`](tightening-research.md) and the four
audits — [type](tightening-audit-type-census.md),
[weight](tightening-audit-weight-census.md),
[spacing/responsive](tightening-audit-spacing-responsive.md),
[colour](tightening-audit-color-restraint.md). Where an audit produced a
per-selector table, that table is binding as written and is not re-litigated
here; this section supplies the rule the table implements, so a new rule
written next month lands in the right place without re-reading the audit.

**Every rule below is checkable and every mapping is mechanical.** The
implement lane applies the mapping tables verbatim; the only inputs it needs
beyond this document are the named per-selector overrides, which are listed
inline. Where a fold-in could plausibly go two ways, the tie-break is stated as
a rule, not left to taste.

### T1. Type scale — eleven steps

Fifteen steps become eleven. The four raised bottom steps are untouched (the
raise is the baseline, not a target); the four steps removed — **12, 13, 18,
48** — all sat above them and all had a surviving neighbour within 1px or one
tier.

| # | px | Name | Allowed on | Not allowed on |
| --- | ---: | --- | --- | --- |
| 1 | **10** | Micro | uppercase eyebrows, table column headers, chips, badges, pills, dense metadata, glyph captions | anything that wraps to a second line |
| 2 | **11** | Caption | secondary/meta lines under a primary label, timestamps, helper text in admin | primary content of a row or card |
| 3 | **11.5** | Dense body | admin body text, table cell text, form helper text | portal/public/landing prose |
| 4 | **12.5** | Body | default reading text in admin; control labels, buttons, small headings | — |
| 5 | **14** | Base | `body` default; generous-density body; card headings on portal/landing | — |
| 6 | **16** | Body large | portal, public and landing paragraph text; card titles; drawer titles | dense admin tables |
| 7 | **20** | Section title | panel and drawer headings, featured card titles, secondary numbers | page-level `<h1>` |
| 8 | **24** | Page title (compact) | page `<h1>` below the 768 breakpoint, portal hero `<h2>`, primary stat numbers | — |
| 9 | **28** | Page title | admin and portal page `<h1>`, landing section `<h2>` | below the 768 breakpoint (step down to 24) |
| 10 | **32** | Display S | wizard/marketing `<h1>`, the headline dashboard stat row, login form `<h1>` | inside a data table or a drawer |
| 11 | **40** | Display M | public event hero `<h1>`, public section `<h2>`, success/CFP welcome `<h1>` | admin surfaces |

Steps 2 and 3 are 0.5px apart and that is uncomfortable, but both are products
of the raise and both are protected. The role split is therefore the rule that
keeps them honest: **11 is a secondary line, 11.5 is primary dense body.** A
new rule may not pick between them on appearance.

#### Exemptions (exhaustive — three, no more)

1. **SVG user units.** `.dashboard-donut text` (3px, 6px) is scaled by a
   `viewBox` and is not device pixels.
2. **The display clamp.** Full-bleed brand `<h1>` may exceed the 40px ceiling
   through **one shared formula and no other**:
   `font-size: clamp(40px, 5vw, 72px)`. It is permitted on exactly two
   selectors — `.hero h1` (landing) and `.login-brand-panel h1` (sign-in) —
   and both must carry the identical declaration. This replaces
   `clamp(48px, 5vw, 71px)` and `clamp(42px, 5vw, 70px)`, whose 1px and 6px
   divergences were noise. It also lets `.hero h1`'s separate 40px narrow-width
   override be deleted: the clamp floor already produces 40px below ~800px
   viewport, so the override is redundant. Net effect at the four verification
   widths: 1440 → 72px (was 71), 1024 → 51.2px (unchanged), 768 → 40px (was
   48 — this is a deliberate reduction that helps the hero-clipping fix in
   [T5](#t5-responsive--four-breakpoints)), 390 → 40px (unchanged).
3. **`font-size: 0`** as the icon-collapse technique (`.agenda-view-tabs
   button` below the narrow breakpoint) is not a size and is not swept. It is
   only legal when the button still renders a visible `svg` and carries an
   `aria-label`.

**The scale is enforced on rendered pixels, not on declarations.** A step can
be left by inheriting a *ratio* as easily as by authoring a wrong number, and
the ratio never appears in this stylesheet. The UA sheet sets
`small { font-size: .8333em }`, so every bare `<small>` renders at whatever
0.8333 × its parent happens to be: measured in Chrome, that was **8.33px** in
the landing preview list and the dashboard table and **9.17px** in the
abstracts rating — under the 10px floor [T7](#t7-accessibility-floors-non-negotiable)
calls non-negotiable — plus 10.42px and 11.67px off-scale elsewhere. The fix is
one reset rule, `small { font-size: inherit }`, which puts every bare `<small>`
on its parent's step; the rules that set an explicit `small` size out-specify
it and are unaffected. **The rule this generalises to: an inherited-ratio
default is a scale violation, and only a browser measurement can see one.**

#### Type fold-in mapping — apply verbatim

Covers every value in the stylesheet today, including the six off-scale leaks
the census found. "Rules" is the measured declaration count in
`src/app/globals.css`.

| Today | → | Rules | Note |
| ---: | ---: | ---: | --- |
| 10 | 10 | 218 | unchanged |
| 10.5 | **11** | 1 | `.command-palette-results button small`; tie between 10 and 11, resolved up — its peer secondary lines are all 11 |
| 11 | 11 | 151 | unchanged |
| 11.5 | 11.5 | 87 | unchanged |
| 12 | **12.5** | 34 | nearest tie, resolved up; also fixes the inversion the raise created (old-11 content now sits at 12.5, above untouched 12) |
| 12.5 | 12.5 | 60 | unchanged |
| 13 | **12.5** | 19 | nearest (0.5 down vs 1.0 up) |
| 14 | 14 | 15 | unchanged |
| 15 | **16** | 2 | except `.landing-feature-grid h3` → **14**, which matches every other card heading on a generous surface |
| 16 | 16 | 9 | unchanged |
| 18 | **20** | 9 | nearest tie, resolved up |
| 20 | 20 | 12 | unchanged |
| 22 | **24** | 2 | `.portal-hero h2`, `.speaker-detail-hero h2` — both generous-density heroes, so up to 24, not down onto the 20 admin-drawer tier |
| 24 | 24 | 12 | unchanged |
| 26 | **28** | 1 | `.share-card h1`, a headline; nearest tie resolved up onto the page-title tier |
| 28 | 28 | 8 | unchanged |
| 32 | 32 | 11 | unchanged |
| 34 | **32** | 1 | `.share-headshot-fallback`, an initials glyph |
| 38 | **40** | 1 | `.login-form-panel form h1`; pairs cleanly with its existing 32px narrow override |
| 40 | 40 | 5 | unchanged |
| 48 | **40** | 1 | `.public-event-hero h1`; its 40px narrow override becomes redundant and is deleted, leaving 40 / 32 across the two breakpoints. Unifies the public hero with `.public-schedule > header h2` on the sibling page |
| `clamp(48px,5vw,71px)` | `clamp(40px,5vw,72px)` | 1 | `.hero h1` |
| `clamp(42px,5vw,70px)` | `clamp(40px,5vw,72px)` | 1 | `.login-brand-panel h1` |
| 3, 6 | unchanged | 2 | SVG exemption |
| 0 | unchanged | 1 | icon-collapse exemption |

Inline `fontSize` in components is in scope and is almost clean already: 10
(×4), 11 (×11), 11.5 (×12), 12 (×1 → **12.5**), 12.5 (×6), 20 (×1).

**Tie-break rule for anything added later:** fold to the nearest surviving
step; an exact tie resolves **upward**. This rule reproduces the type audit's
own per-selector judgement everywhere except `.landing-feature-grid h3`, which
is why that one is carried as a named override rather than a new rule.

**Total blast radius:** 71 CSS declarations + 1 inline + 2 clamp rewrites.

### T2. Line-height — five steps

Line-height had no governing rule before this pass; the census found 17
distinct unitless values plus one in px, with 49% of all declarations sitting
in a single three-value cluster (1.5 / 1.55 / 1.6) doing one job.

| Step | Value | Replaces | Rules | Role |
| --- | ---: | --- | ---: | --- |
| Tight | **1** | .95, .99, 1, 1.06, 1.08 | 6 | single-line display headlines and eyebrow pills |
| Compact | **1.25** | 1.2, 1.25, 1.3 | 7 | compact headings and small UI labels that still need vertical room |
| Standard | **1.4** | 1.35, 1.4, 1.45 | 13 | body and caption text on dense (admin) surfaces |
| Relaxed | **1.5** | 1.5, 1.55, 1.6 | 33 | body text on generous (portal, public, landing) surfaces |
| Loose | **1.65** | 1.65, 1.7, 2 | 8 | long-form marketing paragraphs and bulleted tip lists |

Two rules, no exceptions:

- **Unitless only.** `line-height: 33px` on `.session-date strong` is a
  vertical-centring hack on a fixed 45×53px badge. It is not converted to a
  ratio — the parent gets `display: flex; align-items: center` and the child
  loses its `line-height` entirely. Box-fit centring may not ride on font
  metrics.
- **Wrapped text is never tighter than Standard.** Tight and Compact are legal
  only where the text is single-line or near-single-line by construction (a
  headline with a `max-width` that admits two lines still counts as
  near-single-line; a paragraph does not).

### T3. Weight — three steps

Five steps become three: **400, 600, 700.** 500 is retired into 600; 800 is
retired into 600 (eyebrows and micro-labels) or 700 (glyph substitutes and the
wordmark). The measured problem this fixes: 71% of every weight declaration in
the stylesheet was 700 or 800, so a table cell value competed at the same
visual volume as a page heading.

**400 — body.** Running text, helper text, placeholders, prose. Untouched by
this pass (5 declarations; most body text has no explicit weight at all).

**600 — the default emphasis weight.** Anything that needs to be
*distinguishable from its neighbour*: buttons, field labels, tabs (active and
inactive alike — colour marks the active one), table column headers, table cell
values, chips, badges, pills, links, nav items, current/selected states,
uppercase eyebrows, micro-labels, secondary annotations.

**700 — reserved.** A declaration may use 700 only if it satisfies one of these
five, and the reason must be obvious from the selector:

1. an `<h1>` or `<h2>`, or an `<input>` standing in for one;
2. the **single** primary number in a tile, widget or chart — one per widget,
   never its caption as well;
3. alert or error text that *also* changes colour (weight is never the only
   signal);
4. the product or event wordmark;
5. a glyph substitute — avatar initials, an event mark, a rank digit, a step
   number, a count badge — rendered inside a fixed box with no adjacent running
   text, where the weight buys legibility at 10–12px rather than hierarchy.

Anything at 700 that matches none of the five is a bug and becomes 600.

**Mapping.** The per-selector work is already done and is binding as written:

- `tightening-audit-weight-census.md` §4a — **46 sites 700 → 600** (45 CSS + 1
  inline). Highest-reach entries: `.data-table th`, `.status-badge` (used in 42
  files), `.dashboard-tabs a` (the only tab set in the app that bolded inactive
  tabs), `.stat-tile__label`, `.itinerary-export` (the one button heavier than
  the shared `.button` class).
- §4b and §4d — **16 sites stay at 700** (clauses 1–5 above).
- §4c — `.preview-pane > header` was to be reclassified 700 → 800; with 800
  retired it stays **700** only if it is a glyph substitute, and it is not — it
  is an uppercase panel label, so it becomes **600**, and its sibling
  `.inspector-content > header span` (currently 800) joins it at 600. The two
  panel labels end up identical, which was the point of the original finding.
- **500 → 600**, 4 sites: `.nav-group a b`, `.builder-rail > button > b`,
  `.check-options label`, `.agenda-speaker-picker label`. All are labels.
- **800 → 600**, all uppercase eyebrow / micro-label selectors (`.eyebrow`,
  `.page-eyebrow`, `.nav-group > span`, `.share-eyebrow`, `.public-eyebrow`,
  `.portal-hero-eyebrow`, `.session-card-eyebrow`, `.cfp-step-count`,
  `.live-now-badge`, `.up-next-badge`, `.inspector-content > header span`,
  `.type-grid > button > span`, `.builder-rail > span`, `.email-preview small`,
  `.mini-public > small`, `.success-summary small`, `.portal-resource-grid
  small`, `.accepted-tray > span`, `.agenda-conflict-kind`,
  `.public-session-main > span`, `.welcome-card > span`, `.not-found > span`,
  `.dashboard-live-header > div:first-child > span`, `.dashboard-greeting >
  span`, `.dashboard-stat-row span`, `.dashboard-attention-queue header`,
  `.cfp-aside::before`, `.review-comment header em`, `.public-preview > span`,
  `.login-brand-panel > div > span`, `.demo-code code`).
- **800 → 700**, and only where clause 2, 4 or 5 applies — glyph substitutes,
  wordmarks and primary numbers: `.event-switcher-mark`, `.sidebar-user >
  span`, `.mini-event-logo`, `.public-event-logo`, `.review-comment header
  span`, `.reviewer-stack i`, `.dashboard-rank`, `.speaker-portrait > span`,
  `.rich-text-editor__h` (the "H2" toolbar glyph), `.dashboard-donut text`,
  `.dashboard-attention-queue strong`, `.dashboard-form-progress dd`.

That arithmetic lands 700 at **28 declarations** — 16 kept from the existing
700s, 12 arriving from 800, 29 once `.stat-tile__value` below is added —
against 62 + 40 = 102 today. 600 becomes the plurality weight at ~109
(32 today + 4 from 500 + 45 from the pullback + 28 from 800), and 400 stays at
5. Total declarations are unchanged; only their distribution is.

**One additive fix, called out because omitting it would leave the bug
half-fixed:** `.stat-tile__value` carries no explicit weight and renders at
400, while its own caption `.stat-tile__label` is bolder than the number it
labels. Set `.stat-tile__value { font-weight: 700 }` (clause 2) in the same
pass.

**Checks.** After the pass: `font-weight` declares exactly three values;
`700` appears in **at most 30 declarations** stylesheet-wide; `500` and `800`
appear in **zero**; 600 is the plurality weight; and every surviving 700 maps
to one of the five clauses.

### T4. Spacing — eleven steps in three tiers

The stylesheet uses **58 distinct pixel values** for `gap`, `padding` and
`margin`, odd numbers at every magnitude, with no banding. It becomes eleven,
in three tiers with different permissions.

| Tier | Steps | Where |
| --- | --- | --- |
| **Micro** | 2, 4, 6, 8 | icon-to-text gaps, inline spacing, chip and badge padding |
| **Core** | 12, 16, 24, 32 | the vast majority of gaps, padding and margins on every surface |
| **Macro** | 48, 64, 96 | generous-density surfaces only — landing, public event pages, portal, CFP wizard, login, share and success pages: section rhythm and hero padding |

**Admin surfaces may not use the macro tier.** Admin is `.app-*`, `.topbar`,
`.sidebar*`, `.nav-*`, `.page-*`, `.data-table`, `.drawer*`, `.submission-*`,
`.abstracts*`, `.dashboard-*`, `.crm-*`, `.builder-*`, `.inspector-*`,
`.agenda*`, `.comms-*`, `.settings-*`, `.forms-*`, `.speaker-table*`,
`.review*`, `.task-*`, `.events-index-*`, `.modal`, `.command-palette-*`,
`.empty-state`. Anything that snaps above 32 on one of those selectors is
clamped to **32**. Generous surfaces are `.landing*`, `.hero*`, `.public-*`,
`.portal-*`, `.cfp-*`, `.embed-*`, `.login-*`, `.share-*`, `.success-page*`,
`.resource-detail-page`, `.session-card-*`.

#### Spacing fold-in mapping — apply verbatim

Nearest tier member; **exact ties resolve upward**; then apply the admin clamp.
Counts are measured declaration instances.

Where a cell reads `48 / 32`, the first value applies on generous surfaces and
the second is the admin clamp.

| Today | → | n | Today | → | n | Today | → | n |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 4 | 47 | 23 | 24 | 2 | 50 | 48 / 32 | 3 |
| 5 | 6 | 73 | 25 | 24 | 14 | 55 | 48 / 32 | 1 |
| 7 | 8 | 72 | 26 | 24 | 7 | 56 | 64 / 32 | 5 |
| 9 | 8 | 59 | 27 | 24 | 3 | 58 | 64 / 32 | 1 |
| 10 | 12 | 129 | 28 | 32 | 16 | 60 | 64 / 32 | 4 |
| 11 | 12 | 49 | 30 | 32 | 11 | 62 | 64 / 32 | 2 |
| 13 | 12 | 31 | 31 | 32 | 1 | 65 | 64 / 32 | 2 |
| 14 | 16 | 92 | 34 | 32 | 5 | 66 | 64 / 32 | 2 |
| 15 | 16 | 58 | 35 | 32 | 7 | 70 | 64 / 32 | 4 |
| 17 | 16 | 25 | 36 | 32 | 3 | 75 | 64 / 32 | 1 |
| 18 | 16 | 47 | 38 | 32 | 1 | 78 | 64 / 32 | 1 |
| 19 | 16 | 5 | 40 | 48 / 32 | 9 | 80 | 96 / 32 | 2 |
| 20 | 24 | 57 | 42 | 48 / 32 | 5 | 90 | 96 / 32 | 4 |
| 21 | 24 | 5 | 45 | 48 / 32 | 6 | 92 | 96 / 32 | 1 |
| 22 | 24 | 44 | 47 | 48 / 32 | 1 | | | |

917 declarations move. Already on grid and unchanged: 2 (40), 4 (69), 6 (81),
8 (119), 12 (97), 16 (46), 24 (20), 32 (3), 48 (4), 64 (1), 96 (1).

**Exemptions (exhaustive):**

- **1px** in a spacing property is an optical nudge or a hairline overlap, not
  a spacing decision. 9 instances; leave them. The rule this exemption exists
  to protect is the *opposite* one: 1px may not multiply into 3px/5px/7px
  near-misses, which do function as spacing and are swept above.
- **Offsets that mirror a fixed component dimension** must keep mirroring it:
  `.app-main { margin-left: 236px }` equals the sidebar width;
  `.input-icon input`'s left padding (34px) equals the icon well;
  `.landing-section`'s `scroll-margin-top` equals the sticky `.landing-nav`
  height at each width — **78px** desktop, **66px** below 768;
  `.topbar { padding-left: 64px }` below 768 clears the fixed `.mobile-menu`
  button (12px inset + 44px touch box + 8px clearance), and clamping it to the
  admin tier's 32 slides the topbar's first control under that button; and
  `.session-card-body, .public-session-meta { padding-right: 54px }` below 768
  clears the 44px calendar button with its 5px inset each side. These are
  equalities, not steps: snapping one to the grid without moving the thing it
  mirrors is what lands an anchored heading half-hidden under the nav.
  `scroll-margin-*` is included here because a naive audit sees the substring
  `margin-top` and reports it as spacing.
- **Negative margins that compensate a `transform: scale()`**
  (`.hero-art { margin-bottom: -190px / -220px }`) are paint corrections tied
  to the scale factor, not spacing.
- **One fluid padding clamp**, on the sign-in brand panel and nowhere else:
  `.login-brand-panel { padding: 64px clamp(48px, 6vw, 96px) }`. Both ends are
  macro-tier steps and `.login-*` is a generous surface, so the clamp
  interpolates *between two legal values* rather than leaving the grid — but
  it does render off-grid (61.44px at 1024, 86.4px at 1440, measured), which
  is why it needs naming rather than assuming. This entry exists because the
  rendered-DOM sweep reported it and the exemption list, being exhaustive, had
  no room for it; the choice was to add the entry or delete the clamp. It is
  the exact counterpart of [T1](#t1-type-scale--eleven-steps)'s display clamp,
  and like that one it is permitted on **one selector with one formula**.
- **Fixed component dimensions themselves** — heights, widths, `min-width`,
  grid track sizes, `border-radius` — are out of scope for this grid. Only
  `gap`, `column-gap`, `row-gap`, `padding*` and `margin*` snap.
- **`margin: auto`** resolves to a computed pixel number that varies with the
  viewport (`.container`'s centring reads as 14px at 390 and 130px at 1440).
  It is a centring instruction, not a step; a rendered-pixel audit must filter
  it out or it reports dozens of phantom violations.

**Same caveat as the type scale: the grid binds rendered pixels, not
declarations.** The UA sheet gives block elements a `1em` margin, which is a
ratio and lands off-grid wherever no rule overrides it — measured in Chrome:
`.portal-task-board section > h2` at **10.38px**, `.portal-page-header p` at
**11.5px**, and `.rich-text p` at **12.5px**. Each was given an explicit
on-grid value (12 / 0 / 12) rather than being left to inherit. A blanket
`p, h1-h6 { margin: 0 }` reset is **not** the fix here and was rejected:
`.rich-text` deliberately relies on block margins for prose rhythm and sets
none of its own, so a blanket reset would silently collapse every rendered
description and long-copy block in the app.

#### Sequencing — three waves, because 917 declarations move

The sweep is mechanical but it is not small, and it is the change most likely
to shift a layout by accident. Do it in this order, screenshot-verifying
between waves at 390 / 768 / 1024 / 1440:

- **Wave A — the long tail** (every value above 32, plus 19, 21, 23, 25, 26,
  27, 28, 30, 31, 34, 35, 36, 38): **134 declarations**, changes of ±4px mostly
  on generous surfaces, near-zero perceptual risk. This is the pure drift.
- **Wave B — the core band** (13, 14, 15, 17, 18, 20, 22): **354
  declarations**, ±2px. Verify dense admin tables and card grids specifically.
- **Wave C — the micro band** (3, 5, 7, 9, 10, 11): **429 declarations**,
  ±1–2px, the highest count and the lowest individual visibility. **10 → 12
  alone is 129 declarations** and is the single largest change in the pass; it
  is also the one most likely to relieve the density complaint above. Verify
  fixed-height controls (status pills, table rows, compact selects) for
  clipping.

#### Where the audits' issues map onto this grid

| Audit finding | Grid answer |
| --- | --- |
| Touch targets below 44px (checkbox 14×14, `.mobile-close` 30×20, `.nav-group a` 36px tall) | Micro/core padding buys the hit area: a ≤14px glyph control gets **16px** padding on all sides (14 + 32 = 46 ≥ 44), or a wrapper with `min-width: 44px; min-height: 44px; display: grid; place-items: center`. The 15px/11px padding the audit sketched is off-grid and is not used |
| Abstracts title column cramped at 1024 (`.submission-title-cell { max-width: 340px }`) | A `max-width` is a component dimension, not spacing — exempt from the grid. Fix it in [T5](#t5-responsive--four-breakpoints) by shrinking the Track chip column first, not by growing the title |
| `.landing-nav` 78px height and other 48+ values on admin-adjacent selectors | 78 is a height, so exempt; but every 48+ **spacing** value on an admin selector is a tier violation and clamps to 32 |
| Dashboard recent-submissions table scrolling silently | Not spacing — see [T5](#t5-responsive--four-breakpoints) |

### T5. Responsive — four breakpoints

Eleven ad-hoc `max-width` breakpoints (420, 520, 640, 650, 760, 800, 860, 900,
1000, 1100, 1120) become **four**: `480`, `768`, `1024`, `1280`. Every media
query in `globals.css` uses one of those four widths and no other. This is the
highest-regression-risk item in the pass and is sequenced **last**, after type,
weight and spacing are verified stable.

#### Breakpoint mapping — nearest canonical width, near-ties resolve upward

| Today | → | What lives there |
| ---: | ---: | --- |
| 420 | **480** | narrow-phone patches |
| 520 | **480** | portal container, tab-label collapse, summary rows |
| 640 | **768** | assorted card reflows |
| 650 | **768** | drawer full-width, hero shrink, `.abstracts-table` column hiding, CFP step labels |
| 760 | **768** | portal nav → hamburger, login brand panel hides, public filters |
| 800 | **768** | — |
| 860 | **768** | builder rail collapse (second stage) |
| 900 | **1024** | near-tie (132 vs 124), resolved up |
| 1000 | **1024** | — |
| 1100 | **1024** | builder inspector collapse (first stage) |
| 1120 | **1024** | landing hero → single column, feature grid 4 → 2 |

The mapping preserves every two-stage collapse the app already has: the form
builder keeps a 1024 stage and a 768 stage, because 1100 and 860 land on
different canonical widths.

#### What collapses at each width

| ≤ | Rule |
| ---: | --- |
| **1280** | Dense data tables drop their lowest-priority columns. Binding instance: `.dashboard-recent .data-table` hides Tags (`th/td:nth-child(5)`) — today it silently scrolls 182–202px of content out of view at 768 **and** 1024 with no scroll affordance, while `.abstracts-table` two clicks away already does the right thing. Progressive column disclosure is the pattern; a bare `overflow: auto` is not a responsive treatment |
| **1024** | Three-column layouts become two (builder: inspector collapses). Landing hero becomes one column; the 4-up feature grid becomes 2×2. Tables that hid one column at 1280 hide their second-lowest-priority column |
| **768** | Primary chrome collapses to a menu — admin sidebar to an overlay, portal nav to a hamburger. Two-column page layouts become one. Drawers and dialogs go full-width. Remaining low-priority table columns hide, or the row reflows to a labelled card stack. Touch-target floors in [T7](#t7-accessibility-floors-non-negotiable) apply from here down. **No element may keep a `min-width` above 320px below this width, and text blocks take `max-width: 100%`** |
| **480** | Everything is one column. Tab strips drop their labels and keep icons (`font-size: 0` + visible `svg` + `aria-label`). Core-tier padding steps down one level (24 → 16, 16 → 12). Summary/KPI rows go 2-up |

#### The two confirmed bugs this fixes

- **Landing hero clipped from 390px to ~690px** (critical; measured 284px of
  overflow at 390px, hidden by `.landing { overflow: hidden }`). Cause:
  `.hero-art` keeps `min-width: 620px` all the way down — `transform: scale()`
  shrinks the paint, not the grid contribution — while `.hero h1` and
  `.hero-copy > p` keep fixed `max-width` values. The ≤768 rule above fixes it:
  `.hero-art { min-width: 0 }` and `max-width: 100%` on the two text blocks,
  inside the media block that already exists. Re-verify the whole 390–768 band,
  not just the four widths.
- **Portal header overflows by 14px at exactly 768px** (high; `scrollWidth`
  782 vs `clientWidth` 768, reproducing on every portal page). Cause: the
  hamburger collapse fires at `max-width: 760px`, 8px short of the real tablet
  width. Merging 760 → 768 fixes it by construction — this is the cleanest
  single instance of why the breakpoint set had to be consolidated at all.

Public agenda/speakers carry the same 760/520 shape and are expected to have
the same gap at 768, but they could not be rendered in the audit environment.
Re-screenshot that pair first once the route has a demo path.

### T6. Colour restraint — the accent budget

The rule was already right — "one accent, spent only on action and status" —
so nothing here changes a token or a semantic. What changes is enforcement: the
app currently spends blue and amber on things that are neither actions nor
statuses, which is what makes the real statuses stop registering.

**The budget, per rendered screen, at any width:**

1. **Exactly one non-neutral hue may appear for non-status reasons, and it is
   jade.** Count the distinct hues in a screenshot, excluding `.status-badge`
   and its semantic siblings, excluding the schedule/agenda grid, and excluding
   per-person avatar colours: the answer must be **1**. A "semantic sibling" is
   any element whose colour is bound to a condition — a warning count, a
   progress tone, a form error, an overdue row. If the colour would be the same
   whatever the data said, it is not semantic.
2. **Vivid `--accent` fills: at most one per visual region** — a region being
   the page header, the sidebar, or a single card or panel. One primary button
   per panel. Tints (`--accent-soft`, `--accent-faint`), borders
   (`--accent-border`) and `--accent-dark` text do not count against this;
   they are quiet by construction.
3. **Blue, amber, red and apricot appear only where they carry a status**,
   rendered through `.status-badge`, a semantic banner, a `ProgressBar` whose
   `tone` is bound to a condition, or a form error. Decorative uses: zero.
4. **Colour may never encode a category that a shape or a label already
   encodes.** If removing the colour loses no information, the colour is
   decoration.
5. **One carve-out, and only one:** the schedule and agenda grid surfaces may
   render organiser-chosen track colours, because there colour *is* the scan
   mechanism and grey genuinely will not do. Everywhere else the same component
   renders neutral.

**What got demoted to neutral** (`background: var(--fill); color: var(--muted)`):

| Was | Now | Why |
| --- | --- | --- |
| Six 4-up KPI/summary rows cycling accent / green / amber / blue by array position (`dashboard-page.tsx`, `KpiRow.tsx`, `speakers-page.tsx`, `directory-view.tsx`, `forms-page.tsx`) | **At most two coloured tiles per row**: the headline tile stays jade; at most one further tile may stay amber or green *if* its number is genuinely a warning or a completion count (e.g. Speakers → "Need attention"). Every other tile is neutral | The same hue meant a different thing in every row — amber was a warning on one screen and a plain count on three others |
| `.task-mode-icon` and `.portal-task-icon` tinted by `task.mode` (manual / form / file_request) | Neutral for all three modes | The mode already has a distinct icon shape (Upload / FileText / CheckCircle2); the tint borrowed green and blue for a category with no status meaning. The genuinely semantic `.portal-task-card.completed > .portal-task-icon` green is untouched |
| `ColorChip` forwarding an arbitrary track/tag hex inside data tables (`abstracts-table.tsx`, `plans-view.tsx`, CRM tag chips in `directory-view.tsx`, optionally the portal submission list/detail) | Stop forwarding `color`; render the default `.track-chip` (already neutral in the same file) | In a table the chip sits beside a status badge and an amber rating — three colour systems in one row. In the schedule grid it stays coloured (carve-out 5) |
| `.rating` hardcoded to `--amber` for a star-rating value | `--ink`; the star glyph carries the meaning | A rating is a value, not a warning. Amber spent here is amber that "Pending" in the next column needs. This is the same row where the two demotions above land, so the three fixes verify together |

**Off-token colour, which is already forbidden and is being cleaned up:**

- `ConfirmationMix.tsx` and `rich-primitives.tsx` hardcode `#00a878` /
  `#d98324` / `#c04b4b` for a confirmed / pending / declined triple that
  already has tokens. Swap to `var(--accent)` / `var(--amber)` / `var(--red)`.
- `CUSTOM_TRACK_COLOR = "#6366f1"` in `onboarding-wizard.tsx` is indigo — not
  in the palette at all, and it is what every organiser who types a custom
  track name gets. Move it onto one of the three on-palette values the
  suggested tracks already use.

**Accent-as-text.** The rule that resolves each site, with no judgement left:

- If the declaration colours **text**: use `--accent-dark`. `--accent` is 3.06
  on white and never renders as text on a light surface.
- If it exists only to drive `currentColor` for an inline **SVG**: it is
  permitted on `--surface` or `#fff` (3.06, clears the 3:1 non-text bar) and
  **not permitted** on `--canvas` (2.90), on `--ice` (2.52), or on any tint.
  Those become `--accent-dark`.
- On dark chrome the answer is `--accent-bright`, as it already is elsewhere.

Token-usage context, so the sweep is not mistaken for over-accenting in
general: `--accent-dark` 155 uses, `--accent` 61, `--accent-soft` 45,
`--accent-border` 21, `--accent-faint` 18, `--accent-bright` 12,
`--accent-hover` 3. A text token outnumbering a fill token 2.5:1 is the healthy
shape.

**Correction — there was never a "27-site sweep."** The research file and the
first draft of this section both reported 27 `color: var(--accent)` sites, from
`grep -oE "color:\s*var\(--accent\)[^-]"`. That pattern is unanchored, so it
also matches the tails of **`border-color:`** and **`accent-color:`** — which
is what nearly all 27 hits actually were (`.tabs button.active`'s bottom
border, checkbox `accent-color`, `.template-card:hover`'s border, and so on),
every one of them a correct fill-role use. Anchoring the pattern to the `color`
property itself finds exactly **one** true violation in the whole stylesheet:
`.comms-rail button.active`, which set `color: var(--accent)` (3.06:1) on an
`--accent-soft` tint. It is now `--accent-dark` (5.01:1 on tint). The T8 check
carries the anchored pattern. **The lesson is worth more than the fix: a
finding's headline number is part of the finding, and an unanchored grep for a
CSS property will silently match every longhand that ends in it.**

**What was checked and is already correct — do not "tighten" these:** the
`.status-badge` set and its ~15 status selectors (this is the model everything
else is being pulled toward), the neutral CRM pipeline board, `ProgressBar`'s
condition-bound tones, per-person avatar colours (identity, not status — a
near-universal convention), and `ColorChip` in the schedule grid.

### T7. Accessibility floors (non-negotiable)

These are floors, not targets. Nothing in T1–T6 may be applied in a way that
breaches one; if a fold-in would, the fold-in loses.

- **Minimum font size is 10px**, and 10 and 11 are for glance content only —
  uppercase labels, column headers, chips, numeric metadata. **Text that wraps
  to a second line is never below 11.5px.** Continuous prose is ≥11.5px on
  admin surfaces, ≥14px on portal, public and landing surfaces, and ≥16px for
  marketing paragraph copy.
- **Contrast.** Text ≥4.5:1; large text (≥24px, or ≥18.5px at 700) ≥3:1;
  non-text UI and graphical objects ≥3:1. The two documented deviations in
  "Known deviations" are the only permitted exceptions, and neither may be
  extended: no new `--line-strong`-class deviation, and no `--accent`
  indicator on `--canvas` that is the sole signal.
- **Touch targets.** At ≤768px every **discrete control** has a hit area of at
  least **44×44 CSS px**, achieved with grid padding (a 12–14px glyph plus 16px
  padding lands at 44–46) or a `min-width`/`min-height` wrapper. Above 768px
  the floor is 32×32 with ≥8px separation. A discrete control is a button, an
  icon button, a checkbox or radio (via its wrapper), a text input or select, a
  tab, a pagination control, or a wordmark/nav link — anything the user aims at
  as an object.

  **Exempt: links inside a line of text.** WCAG 2.5.8's *Inline* exception
  covers a target "in a sentence, or whose size is otherwise constrained by the
  line-height of non-target text" — forcing 44px on those would space out the
  prose they sit in, which is why the standard carves them out. In this app
  that is "View all", "View event", "Add to calendar", "Need help?", "Forgot
  your password?" and the mailto link in the abstracts drawer. They keep their
  text height; the surrounding row supplies the spacing.

  **Two mechanics, both measured in Chrome rather than reasoned about:** a
  native checkbox ignores `padding` and derives its box from `width`/`height`
  alone, so it needs the `.checkbox-hit` wrapper *and* must be excluded from
  any blanket `input { min-height }` or it renders as a 14×44 lozenge; and
  `min-height` beats the fixed `height` these controls already set, so each
  floor costs one declaration and desktop sizing is untouched.

  The originally-named offenders were the abstracts row checkbox (14×14, and
  the padded cell around it stopped the click), the mobile sidebar close button
  (30×20 — the only way out of a full-screen overlay), and mobile nav links
  (36px tall). Fixing only those left the floor breached on 7 of 9 surfaces,
  because **every button-class control was also under it** — `.button` at 38,
  `.button-sm` and pagination at 27–32, the toolbar controls at 34. No
  stylesheet grep finds this; it is only visible by measuring
  `getBoundingClientRect()` on a rendered page, which is why T8's touch-target
  check is a browser sweep and not a CSS audit.

  **The 32×32 half of this rule went unimplemented for two years of passes,
  and the reason is worth keeping.** Every earlier sweep ran at ≤768 because
  that is where the 44px floor bites, and at that width `.brand,
  .portal-event-brand, .dashboard-tabs a { min-height: 44px }` already covers
  the wordmarks — so they passed. Measured at 1024 and 1440, where that rule
  does not apply and no other sets a height, the landing and sidebar wordmarks
  render **27px** tall, the portal event brand 25, the CFP footer wordmark 20,
  the landing nav links 14 and the portal footer links 11. All are named
  discrete controls; all were under the floor; none of it was visible to a
  grep, because none of those rules mentions a height at all. The base-width
  floor is now written next to the ≤768 one. **A floor with two thresholds
  needs sweeping at both, or the looser one silently becomes the only one.**

  Two controls were under *both* floors at every width and needed more than a
  `min-height`: the portal session card's 20×20 chevron link, which sits in a
  20px grid column and so takes an absolutely-positioned `::before` expander
  rather than growing its column, and the completed-task card's 33×13 "View"
  button.

  **Known residual, accepted:** the landing hero's `.preview-window` holds a
  mock app UI built from real `<a>`/`<button>` elements (a 14×22 brand mark, a
  29×14 "＋ Add"). They are decoration inside a screenshot-like illustration,
  not controls, and sit under the floor at every width. The right fix is
  `aria-hidden` plus `tabindex="-1"` on the mock — a markup change to the
  landing page, not a token one. Recorded here, not done in this pass.
- **Focus.** Every interactive element keeps the 3px `--focus-ring`. It is
  never removed, and never traded for a colour change alone.
- **Colour is never the only signal.** Status carries a text label, task modes
  carry an icon shape, alerts carry weight *and* colour. This is what makes the
  demotions in T6 safe.
- **Line-height.** Wrapped text is ≥1.4; portal, public and landing prose is
  ≥1.5.
- **Reduced motion and text zoom** are unchanged by this pass, but a layout
  that only works because a value is expressed in px must still survive 200%
  zoom — the four canonical breakpoints are what it lands on when it does.

### T8. Verification

Run from the repo root after each stage. Expected values are post-pass.

```bash
# T1 — font sizes: expect exactly 11 steps + 3px/6px SVG
grep -oE "font-size:\s*[0-9.]+px" src/app/globals.css | sed -E 's/font-size:\s*//' | sort -n -u
# T1 — the zero-size exemption: `.agenda-view-tabs button` hides its label at
# the tab-icon breakpoint. The pixel grep above can never report this — a
# unitless `0` has no `px` to match — so it needs its own check.
grep -c "\.agenda-view-tabs button{font-size:0}" src/app/globals.css  # expect 1
# T1 — both clamps identical
grep -c "clamp(40px, *5vw, *72px)" src/app/globals.css        # expect 2
grep -oE "font-size:\s*clamp\([^)]*\)" src/app/globals.css | sort -u  # expect 1 line

# T2 — line-heights: expect exactly 1, 1.25, 1.4, 1.5, 1.65 and no px
grep -oE "line-height:\s*[0-9.]+[a-z%]*" src/app/globals.css | sed -E 's/line-height:\s*//' | sort -u

# T3 — weights: expect only 400, 600, 700; 700 at most 30 declarations
# ("at most 30" is the rule, per T3's table and its prose. The stylesheet
# currently sits at exactly 30, so a new 700 is a violation, not a drift.)
grep -oE "font-weight:\s*[0-9]+" src/app/globals.css | sed -E 's/font-weight:\s*//' | sort -n | uniq -c
grep -rhoE "fontWeight:\s*[0-9]+" src --include=*.tsx | sort | uniq -c

# T4 — spacing: expect 1,2,4,6,8,12,16,24,32,48,64,96 plus the named offsets
grep -oE "(gap|column-gap|row-gap|padding(-[a-z]+)?|margin(-[a-z]+)?):[^;}]*" src/app/globals.css \
  | grep -oE "[0-9]+px" | sort -n -u

# T5 — breakpoints: expect exactly 480, 768, 1024, 1280. The rule is
# max-width only — the app has no min-width, width, or range-syntax media
# queries — so the width-extraction grep is intentionally scoped to that
# form. The second command is what enforces the scoping claim: it must
# return nothing (aside from prefers-reduced-motion, which isn't a
# breakpoint) or a new query form has appeared that the first command is
# blind to.
grep -oE "@media[^{]*max-width:\s*[0-9]+px" src/app/globals.css | grep -oE "[0-9]+px" | sort -n -u
# NB: `@media\(` only matches the minified, no-space form. The stylesheet also
# holds ~10 space-separated queries (`@media (max-width: 768px)`), which that
# pattern cannot see at all — it would report "no output" even if one of them
# used min-width. Match the prelude instead, and sweep every stylesheet, not
# just this one: the app's other CSS file kept a 650px query through the whole
# 2026-08 pass precisely because these greps are scoped to globals.css.
grep -rnoE "@media[^{]*" src --include=*.css | grep -vE "max-width|prefers-reduced-motion"  # expect no output
grep -rnoE "@media[^{]*" src --include=*.css | grep -oE "max-width: ?[0-9]+px" | sort -u  # expect only 480/768/1024/1280

# T6 — accent as text: every hit must be an SVG on --surface/#fff
# NB: this pattern also matches the tails of `border-color:` and
# `accent-color:`, which is why it once reported "27 sites" when there was
# really one. Anchor it to catch only the `color` property itself:
grep -noE "(^|[;{[:space:]])color:\s*var\(--accent\)[^-a-z]" src/app/globals.css
# T6 — no raw hex outside :root, gradients and #fff on fills.
# The naive version of this check (`grep -v "^\s*--" | grep -vi gradient`)
# has two real bugs, not just style: piping through `-n` first prepends
# "123:" to every line, so the `^\s*--` anchor meant to skip token
# declarations no longer matches anything and the whole :root block leaks
# through as false positives; and a plain "does the line say gradient"
# filter cannot bound a `linear-gradient(...)` call once one of its stops is
# itself a `var(...)` call, since the naive non-greedy match closes on that
# inner paren instead of the outer one. Strip comments, custom-property hex
# declarations, gradient() calls (allowing one level of nested parens), and
# permitted `#fff` fills before matching:
perl -0777 -pe '
  s{/\*.*?\*/}{}gs;
  s{--[a-zA-Z0-9-]+:\s*\#[0-9a-fA-F]{3,8}}{}g;
  s{[a-z-]*gradient\((?:[^()]|\([^()]*\))*\)}{}g;
' src/app/globals.css | grep -noE "#[0-9a-fA-F]{3,8}"   # expect no output
# Sweep every stylesheet, not just this one — same scoping bug as T5's:
for f in $(git ls-files '*.css'); do perl -0777 -pe '
  s{/\*.*?\*/}{}gs; s{--[a-zA-Z0-9-]+:\s*\#[0-9a-fA-F]{3,8}}{}g;
  s{[a-z-]*gradient\((?:[^()]|\([^()]*\))*\)}{}g;' $f | grep -noE "#[0-9a-fA-F]{3,8}"; done
# `white`/`black` are the same literal by another spelling and the hex pattern
# cannot see them. So is a colour hidden in a JSX attribute (`stopColor`).
grep -noE "(color|background|border-color|fill|stroke):\s*(white|black)\b" src/app/globals.css
grep -rnE "#[0-9a-fA-F]{6}" src --include=*.tsx | grep -v "seed.ts\|fixtures.ts\|cfp-wizard.tsx"
```

**This is now zero, and it is meant to stay zero.** The `fill: #fff` clause the
filter used to carry is gone with the last raw `#fff`: white is `--on-fill`.
The retokenization that closed it out is recorded under "Known deviations"
below; what matters here is that the command changed status. It used to be a
lint aid that reported 79 pre-existing matches and could only catch *new* raw
hex against that noise floor. With the floor at zero it is a real gate: any
output at all is a regression.

Two caveats on the `.tsx` sweep, both about what a hex in a `.tsx` file
actually is. Track and accent colours are **organiser data** — they live in
DB defaults, zod schemas and fixtures, and a hex is the correct representation
there; those files are excluded by name. But a hex in a *presentational*
attribute is a rule body wearing a disguise: `stopColor="#00a878"` on an SVG
gradient stop was invisible to every check here until it was moved into
`.chart-plot linearGradient stop { stop-color: var(--accent) }`. The test is
not the file extension, it is whether the value paints a pixel this stylesheet
should own.

Screenshot verification is part of the definition of done, not a follow-up:
390 / 768 / 1024 / 1440 on landing, login, dashboard, abstracts (list and open
drawer), portal home, portal tasks, and the CFP wizard, after **each** of T4
Wave C and T5. The 390–768 band gets a continuous sweep after the hero fix, not
just the four checkpoints, because that bug lives between them.

**The greps above are necessary and not sufficient, and the gap is
structural.** Each one reads *declarations in this file*; three of the rules
they enforce bind *rendered pixels*, and the difference is where every finding
of the final pass lived. A stylesheet grep cannot see an inherited UA ratio
(`small`'s `.8333em`, a block element's `1em` margin), cannot see a computed
`margin: auto`, and cannot see a control's actual box (`.button` is `38px` in
this file and under the 44px floor only once a phone renders it). So the
definition of done includes a **rendered-DOM sweep** over the same surfaces and
widths, asserting on `getComputedStyle` and `getBoundingClientRect`:

1. every text-bearing element's `font-size` is one of the eleven steps, or one
   of [T1](#t1-type-scale--eleven-steps)'s three exhaustive exemptions (the
   display clamp, the `.dashboard-donut` SVG user units at 3px/6px, or
   `.agenda-view-tabs button`'s `font-size: 0`), and none of the eleven steps
   is below 10px;
2. every `font-weight` is 400, 600 or 700;
3. every `gap`/`padding*`/`margin*` is on the eleven-step grid, or one of
   [T4](#t4-spacing--eleven-steps-in-three-tiers)'s exhaustive exemptions
   (1px nudges, offsets that mirror a fixed component dimension, negative
   margins compensating a `transform: scale()`, or a computed `margin: auto`)
   — all four must be filtered out, not just `auto`;
4. `document.documentElement.scrollWidth <= innerWidth` — no page-level
   horizontal overflow (elements overflowing *inside* an `overflow:auto`
   container are correct and must not be reported: the abstracts table and the
   status-tab row both legitimately scroll at 390);
5. every discrete control clears 44×44 at ≤768 and 32×32 above, measuring the
   `.checkbox-hit` **wrapper** rather than the checkbox it contains;
6. the count of distinct non-neutral hues in text colour stays within the
   [T6](#t6-colour-restraint--the-accent-budget) budget.

The script used for the 2026-08 pass lives outside the repo (it is a
verification tool, not shipped code) at
`~/Code/tmp/ultracode-design/final/verify.mjs`, with its output in
`report.json` beside the screenshots. The rerun after the retokenization is at
`~/Code/tmp/ob-retoken/verify.mjs` — 8 surfaces × 4 widths, Playwright rather
than CDP, with the same six assertions plus a dump of every distinct computed
text colour.

**Three things that pass make the sweep worth writing carefully**, because
each one was a false positive that hid a real finding underneath it:

1. **`margin: auto` must be read from the CSSOM, not inferred from the box.**
   `getComputedStyle` reports the *resolved* free space — 426px, 2.9375px,
   250.797px — with no trace of the keyword, so a naive sweep reports 361
   spacing violations that are all one exemption. Inferring it from shape
   ("equal left and right margins on a narrow block") only finds centring and
   misses every one-sided `margin-left: auto`, which is the form this app
   actually uses. Walk `document.styleSheets`, collect the rules that declare
   `auto` on a margin longhand or shorthand, skip `@media` blocks whose
   `conditionText` does not currently match, and ask `el.matches()`.
2. **Inherited exemptions need `closest`, not `matches`.** A `<span>` inside
   the clamped `<h1>` renders at 51.2px with no declaration of its own.
3. **A hue-bucket count cannot measure [T6](#t6-colour-restraint--the-accent-budget)
   in this palette.** The neutrals are deliberately tinted — `--ink` is
   62% "saturated" by the usual formula — so every grey lands in a hue bucket
   and the number means nothing. Dump the distinct computed `color` values and
   check them against the token list instead. Doing that is what surfaced the
   `<dialog>` reset: 28 elements at `rgb(0, 0, 0)`, a value no token has.

Current state, measured across all 32 view/width combinations: **zero**
off-scale font sizes, line-heights, weights, or spacing values; zero
page-level horizontal overflow; zero touch targets under floor; and ten
distinct computed text colours, every one of them a token.

#### Order of application

Risk ascends, so apply in this order and let each land before starting the
next: **T1 → T2 → T3 → T6 → T4 (A, B, C) → T5.** T1–T3 are token-level and
cannot move a box. T6 is subtractive and cannot move a box either. T4 moves
boxes by 1–4px each. T5 changes which layout renders at which width and is the
only item that can break a page outright.

#### Getting the gated surfaces on screen

Four of the surfaces above are behind `middleware.ts`'s `/events` gate, which
only opens when `isCredentialFreeLocalDemo()` is true, and this worktree's
`.dev.vars` carries a real `SESSION_SECRET`. **Do not edit `.dev.vars`** — the
harness refuses it, correctly. The working route is the opt-in
`DESIGN_AUDIT_DEMO=1` gate in `next.config.ts` described in
[`tightening-audit-spacing-responsive.md`](tightening-audit-spacing-responsive.md)
("Method"): skip `initOpenNextCloudflareForDev()` so `getEnv()` falls through
to `process.env`, and append `'unsafe-eval'` to the dev CSP so React Refresh
can hydrate. Revert `next.config.ts` before finishing. Two route trees have no
demo path at all — the admin form builder (`eventIdSchema.parse` rejects the
demo event's non-UUID id) and `/e/[eventSlug]/agenda|speakers` (no
`isCredentialFreeLocalDemo()` branch) — so they stay CSS-review-only until
someone gives them one.

## Extending this

- Never write a raw hex in a rule body. If no token fits, add one here first.
- Text is `--ink` or `--muted`. On dark surfaces it is `--on-dark`,
  `--on-dark-muted` or `--on-dark-faint`, chosen explicitly.
- A new semantic colour needs all three of foreground, border and tint, and
  the foreground must clear 4.5:1 on both white and its own tint.
- Font sizes come from the eleven-step scale; line-heights from the five steps;
  weights from the three steps; gaps, padding and margins from the eleven-step
  spacing grid; media queries from the four canonical breakpoints. A value not
  on one of those lists is a bug, not a decision — **unless it falls under a
  named exemption**, in which case it stays as written. The exemptions are
  closed lists, not precedent: [T1](#t1-type-scale--eleven-steps)'s three
  (display clamp, SVG user units, `font-size: 0`) and
  [T4](#t4-spacing--eleven-steps-in-three-tiers)'s four (1px nudges, mirrored
  offsets, `transform: scale()` corrections, computed `margin: auto`) are the
  only ones a future extension may lean on without adding a new one here
  first — verification and any future audit must exclude them rather than
  flag or "fix" them.
- Colour that is not jade must carry a status. See
  [T6](#t6-colour-restraint--the-accent-budget) for the per-screen budget.
- Dark mode is not implemented. See below for what it would actually take.
- Interaction patterns, per-surface density intent, and the experience-polish
  catalog live in [`experience-design.md`](experience-design.md); this
  document stays scoped to colour and typography.

## Dark mode

**The palette is dark-mode *shaped*. The app is not dark-mode *ready*.** Those
are different claims and it is worth keeping them apart.

What is genuinely in place: colour is fully tokenized, the semantic tokens are
split into foreground / border / tint so a theme can redefine each role
independently, and dark surfaces are already first-class — `--sidebar`,
`--sidebar-2`, `--sidebar-line` and a contrast-verified `--on-dark` /
`--on-dark-muted` / `--on-dark-faint` text ramp. Those exist because the
sidebar, the event covers and the portal hero cards are permanently dark
regardless of theme.

The Jade + Ice palette was chosen with a dark theme in mind, and the dark
value set below is already contrast-verified. What is *not* done is the
structural work — the app still encodes light-mode assumptions outside the
token layer.

### Verified dark value set

Computed against WCAG 2.1 relative luminance; all pairs pass AA on their
stated ground unless marked.

- **Surfaces:** canvas `#102a2a` (the light theme's ink), cards `#16332f`,
  sidebar one step darker at `#0b1f1f` so it keeps its anchor role (16.23 with ink on it).
- **Text:** ink `#f6faf9` — 14.39 on canvas, 12.89 on cards. Muted `#93aca6`
  — 6.27 / 5.61 (the light theme's `--on-dark-muted` ramp is reusable as-is).
- **Jade as text passes on dark:** `#00a878` is 4.96 on the canvas — but only
  4.44 on raised cards, so small jade text on cards uses `#0fc38f` (5.96).
- **The primary button is theme-invariant:** `--accent` fill with
  `--on-accent` text is 4.96 in both themes, because `--on-accent` *is* the
  dark canvas colour. No per-theme button variant is needed.
- **Ice is theme-invariant:** the same `#cbefff` hex reads as a glowing
  highlight panel on dark — 12.50 with ink text on it.
- **Apricot as text is legal on dark:** `#ffb86b` is 8.89 on the canvas —
  the warning foreground can be the vivid hex itself, no darkened companion.
- **Semantics swap polarity:** red fg `#ff8177` on tint `#2e1814` (6.24 on
  canvas), blue fg `#6bb2e0` on tint `#14222b` (6.54). Green and amber merge
  into the accent and apricot families as in light mode.

### The remaining structural work

Dark mode is still not a token swap. The evidence is already in this file:
`.embed-shell.embed-dark`, which themes a single embedded schedule view,
needs **25 rules — and only 2 of them set tokens.** The other 23 are
per-selector patches. That is the realistic ratio for the rest of the app,
not an outlier.

1. **A shadow strategy.** `--shadow` and `--shadow-sm` are dark `rgba`, plus 18
   more hardcoded `box-shadow` declarations. A dark shadow on a dark surface is
   invisible; elevation becomes a ladder of lighter surfaces plus borders.
   This is a design decision, not a find-and-replace.
2. **White-on-fill text.** `--on-accent` now exists and the jade fills use it,
   but `#fff` literals remain on semantic fills and avatars. Each needs a
   token before the fills can lighten for dark mode.
3. **~50 remaining literals** that encode light-mode assumptions —
   `.button-secondary` text, `.field` labels, `.landing-links`, `.rich-text`,
   `.logo-strip`. Each needs a token before it can be themed.
4. **Overlay colours.** 33 dark `rgba()` overlays (hover states such as
   `rgba(16,42,42,.06)`) need light counterparts; 20 `rgba(255,255,255,…)`
   already assume dark chrome and would need the reverse treatment.
5. **A design answer for the already-dark surfaces.** The sidebar,
   `.event-cover` and `.welcome-card` currently read as dark *because* the
   page around them is light. On a dark page the special surfaces should
   become the light ones — the ice panel and a near-white "paper" card
   inherit that highlight role. Gradient stops are bespoke and were
   deliberately left untokenized.
6. **A perimeter decision.** Emails must stay light regardless (email clients
   ignore app theming — `emailLayout` keeps its own light palette). Embeds
   ship `theme: "light"` as a customer-facing default; flipping it is a
   breaking change for embedding sites, so dark stays opt-in there. The open
   product call is whether the public event pages follow the admin theme or
   stay light.

None of this is blocked — it is just real work, and step 5 is a design
question before it is an implementation one. The value-set question, which
used to be the risky part, is answered above.
