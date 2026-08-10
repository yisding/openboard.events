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

## Typography

### Typeface

**Archivo**, loaded through `next/font/google` in `src/app/layout.tsx` and
exposed as `--font-sans`.

The stylesheet previously asked for Inter, but Inter was never loaded — there
was no `next/font` call, no `@font-face`, and no font file in `public/`. Every
visitor without Inter installed locally fell through to `ui-sans-serif`.

Archivo was chosen over Inter for three reasons:

1. It carries a **100–900 variable weight axis**. The scale below needs five
   distinct weights, and a variable face is what makes them distinct.
2. It is a grotesque drawn for both text and display, which this app needs:
   the same family sets 8px table labels and a 48px hero.
3. It is not Inter. Inter has become the default signature of this class of
   product; Archivo has more character in the `a`, `g` and `R` without
   costing legibility at small sizes.

`next/font` self-hosts the file at build time, so there is no runtime request
to a font CDN, no CSP entry to maintain, and no layout shift beyond `swap`.
The latin subset is ~35KB.

### Weight

Five steps. The stylesheet previously used eleven — 450, 500, 560, 570, 600,
620, 650, 700, 750, 800 and 850. Seven of those are values only a variable
font can render; against the system fallback they collapsed onto whatever
weights it happened to ship, so most of the intended hierarchy was invisible.

| Weight | Use | Rules |
| --- | --- | --- |
| 400 | body, helper text | 3 |
| 500 | nav labels, de-emphasised UI | 3 |
| 600 | buttons, field labels, tabs | 27 |
| 700 | headings, table values, emphasis | 38 |
| 800 | uppercase eyebrows and micro-labels | 32 |

### Size

Fifteen steps: 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48.
Base is 14px on `body`, which is right for a dense operations tool.

This replaces 34 authored sizes, including one-offs at 23, 25, 27, 29, 31, 34,
35, 43, 44 and 50px. The sub-8px tail (6px and 7px, 53 rules) was lifted to 8px.

Two rules are exempt: `.dashboard-donut text` sets font-size in SVG user units
scaled by a `viewBox`, so its 3px and 6px values are not device pixels.

Numbers use `font-variant-numeric: tabular-nums` in data tables, stat tiles and
anywhere figures stack vertically.

### Open issue: density

**The app is authored at roughly 0.6× conventional UI sizing and this document
does not fix that.**

337 of 488 real-UI rules set a font size below 11px — the practical floor for
comfortable reading. That is 69% of the interface, not a tail of outliers.
41 of those rules place text inside a *fixed* height as small as 16px, so the
type cannot grow on its own without clipping.

Raising the floor is therefore a coordinated re-scale of type **and** box
dimensions — heights, padding, gaps, grid columns — not a stylesheet cleanup.
Done mechanically it would be a uniform ~1.35× on the component scale, which
also changes how much fits on screen. That is a product decision about
information density and needs visual QA across every screen.

Recommended as a separate piece of work. Until then, treat 8px as the floor
and do not add new rules below it.

## Extending this

- Never write a raw hex in a rule body. If no token fits, add one here first.
- Text is `--ink` or `--muted`. On dark surfaces it is `--on-dark`,
  `--on-dark-muted` or `--on-dark-faint`, chosen explicitly.
- A new semantic colour needs all three of foreground, border and tint, and
  the foreground must clear 4.5:1 on both white and its own tint.
- Font sizes come from the fifteen-step scale; weights from the five steps.
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
