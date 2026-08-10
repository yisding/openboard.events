# Openboard design system

Colour and typography for the admin app, the speaker portal and the public
event pages. All of it lives in `src/app/globals.css`; there is no Tailwind
theme and no design-token package.

The rule this document exists to enforce: **every colour in the stylesheet
resolves to a token in `:root`.** A raw hex in a rule body is a bug unless it
is a gradient stop or white text on a coloured fill.

## Colour

The neutral ramp is deliberately purple-tinted (hue ≈255) so it reads as part
of the brand rather than as a separate grey system sitting next to it. That is
why `--ink` is `#19182d` and not a true black, and why the borders carry a
faint violet cast.

### Surfaces and lines

| Token | Value | Use |
| --- | --- | --- |
| `--surface` | `#ffffff` | cards, inputs, table rows |
| `--surface-raised` | `#faf9fc` | hover states, inset panels |
| `--canvas` | `#f7f7fa` | page background |
| `--fill` | `#f1eff4` | segmented controls, chips, inert fills |
| `--fill-strong` | `#eceaf0` | pressed and selected fills |
| `--line` | `#e7e5ec` | default border |
| `--line-strong` | `#dcd9e4` | input and control borders |
| `--line-heavy` | `#c8c5cf` | dividers that need to carry weight |

### Text on light surfaces

| Token | Value | On `--surface` | On `--canvas` |
| --- | --- | --- | --- |
| `--ink` | `#19182d` | 17.36 | 16.23 |
| `--muted` | `#6c6a7d` | 5.26 | 4.92 |
| `--subtle` | `#85818f` | 3.79 | 3.55 |

`--ink` and `--muted` are the only two tokens permitted for real text. There is
no third text weight: hierarchy below `--muted` is expressed with size and
weight, not with a lighter grey.

`--subtle` is **not a text token.** It is for placeholders and decorative
glyphs — content that is duplicated by a visible label and is not required to
operate the interface. It clears the 3:1 bar in WCAG 1.4.11 for non-text
contrast but deliberately does not reach 4.5:1, because a placeholder rendered
at full text contrast is indistinguishable from a filled-in value. Every input
that uses it has a persistent `<label>` via `.field`.

### Dark surfaces

| Token | Value | On `--sidebar` | On `--sidebar-2` |
| --- | --- | --- | --- |
| `--on-dark` | `#eae7f3` | 14.63 | 13.15 |
| `--on-dark-muted` | `#9f9bb3` | 6.64 | 5.97 |
| `--on-dark-faint` | `#8f8aa6` | 5.40 | 4.85 |

Surfaces: `--sidebar` `#17152a`, `--sidebar-2` `#211e39` (raised chrome such as
the event switcher), `--sidebar-line` `#312d47`.

Note that selectors in this file are written flat — `.nav-group a`, not
`.admin-sidebar .nav-group a` — so a tool cannot infer from the CSS alone that
those rules render on a dark surface. If you add a rule inside the sidebar,
pick the `--on-dark-*` token explicitly.

### Brand

`--purple` `#6958d7` is the only accent used for identity: primary buttons,
active nav, links, focus rings.

| Token | Value | Use |
| --- | --- | --- |
| `--purple` | `#6958d7` | brand, 5.28 on white |
| `--purple-dark` | `#5544bd` | hover; text on `--purple-border` (5.19) |
| `--purple-light` | `#8d7feb` | brand on dark surfaces, 5.41 on `--sidebar` |
| `--purple-border` | `#ded8fa` | borders on tinted purple |
| `--purple-soft` | `#eeebff` | tinted background |
| `--purple-faint` | `#f6f4ff` | barely-there tint, selected rows |

### Semantic

Each semantic is a triple: a foreground, a border, and a tinted background.
The foreground is contrast-safe **on both white and its own tint**, because
both pairings occur in the app.

| | Foreground | Border | Background | fg on white | fg on tint |
| --- | --- | --- | --- | --- | --- |
| green | `#1b6b58` | `#bfe4d6` | `#e7f6f1` | 6.38 | 5.73 |
| amber | `#8a5c12` | `#efd8b3` | `#fff3d8` | 5.80 | 5.27 |
| red | `#af323d` | `#eccccc` | `#fdebed` | 6.28 | 5.46 |
| blue | `#2a6486` | `#c8e4f2` | `#e8f3fa` | 6.43 | 5.71 |

These foregrounds were darkened from the original palette. The old values
(`#24866e`, `#ad741a`, `#c54a54`, `#357ea8`) landed between 3.6 and 4.1 on
their own tints — ratios that only pass AA at *large* text sizes, while the
app uses them almost exclusively for 8–10px labels and badges. White text on
the solid fills was failing for the same reason (`white on green` was 4.46);
it now ranges 5.80–6.43.

### Known deviation

Border tokens do not meet 3:1 against their surrounding surface
(`--line-strong` is 1.39 on white). WCAG 1.4.11 exempts purely decorative
separators, which covers `--line` and `--sidebar-line`. The arguable case is
`--line-strong` on inputs, where the border is part of the control boundary.
This is a deliberate deviation: raising it to 3:1 requires roughly `#8f8b96`,
which makes every form in the product read as heavy and boxed. The mitigation
is that all inputs carry a persistent visible label and a 3px `--focus-ring`.
Revisit if the product ever needs a strict AA conformance claim.

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
- Dark mode is not implemented. `.embed-shell.embed-dark` overrides three
  tokens for embedded schedule views and is the proof that the token layer can
  carry a theme — a full dark mode is now a token swap rather than a rewrite.
