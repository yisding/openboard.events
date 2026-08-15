# OpenBoard design system

This file records the enforceable visual contracts behind the shared tokens in
`src/app/globals.css`. Product components should consume the tokens and shared
primitives rather than recreating their own scales.

## Semantic color

Jade is the brand and interaction color: primary actions, selected navigation,
focus, and links. Outcome badges use semantic tone classes so they remain
visually distinct from interactive chrome:

| Tone | Meaning | Foreground / background | Contrast |
| --- | --- | --- | ---: |
| Success | Accepted, sent, live, complete | `--green` / `--green-soft` | 5.01:1 |
| Review | Pending review, scheduled, awaiting confirmation | `--blue` / `--blue-soft` | 5.31:1 |
| Queued/warning | Decision queues, past due, needs placement | `--amber` / `--amber-soft` | 5.36:1 |
| Danger | Declined, failed, bounced, overdue | `--red` / `--red-soft` | 5.46:1 |
| Neutral | Draft, withdrawn, closed, roles and sources | `--muted` / `--fill` | 4.59:1 |

Ratios use WCAG 2.1 relative luminance. Every pair clears 4.5:1 for normal text.
The leading dot is redundant reinforcement; color is never the only signal
because every badge also has an authored user-facing label.

Text on light grounds is a two-step ramp: `--ink` (15.4:1 on `--surface`) for
content, `--muted` (5.27:1) for everything secondary — labels, placeholders,
adjacent-month calendar days. There is no lighter third step; a new one may
only be added if it clears 4.5:1 on `--canvas`, the lightest ground text can
land on.

`StatusBadge` accepts only the keys in `STATUS_BADGES`. A new backend enum must
therefore receive an explicit label and tone before it can render. The component
emits only `.status-tone-*` classes, and its unit test verifies every emitted
class has a stylesheet rule. `statusBadgeLabel()` returns the same authored
label without the chip, for the controls that *select* a status — filters,
option pickers, CSV cells — so a picker cannot drift from the badge beside it.

Placeholder avatars are the one pair whose foreground and background come from
the same value: `.person-avatar-placeholder` tints the disc `--avatar-accent`
8→18% into `--surface` and draws the initials in
`color-mix(--avatar-accent 75%, --avatar-ink)`. The raw accent on its own tint
caps at about 3.6:1 whichever hue is picked, so the mix toward `--avatar-ink` is
what carries the contrast. It is a token of its own rather than `--ink` because
the dark embed remaps `--ink` to the near-white `--fill` while leaving
`--surface` alone, which would mix the glyph toward its own ground; keep
`--avatar-ink` out of every scoped remap. Every hue admitted to
`--avatar-hue-1…10` must clear 4.5:1 against the 18% stop — worst case today is
4.82:1 — and `src/shared/ui/avatar-hue-contrast.test.ts` enforces it in both the
light shell and the dark embed. The default accent is one of those hues, but on
`.public-event` and `.embed-shell` `--accent-dark` is not a token at all: the
public shell writes the organizer's brand colour into it inline, and that colour
is only proven as *text on white*, which is a different measurement — a branded
embed measured 3.64:1 this way. Those two shells therefore pin
`--avatar-accent` back to `--avatar-hue-1`, and the same test file checks that
the pin names a hue it validates. The landing hero's
solid `.avatar-1/-2/-3` discs are a separate contract: white initials on a
saturated fill, measured against white.

## Color tokens

Every colour in `src/app/globals.css` resolves to a token, and `:root` is the
only place a hex may be spelled out. This is not tidiness: `--on-dark-muted`'s
published ratios are computed from the dark gradient stops, so those stops are
tokens (`--dark-hero-to` is the lightest ground any dark surface reaches, which
is what sets that token's value) and an unnamed stop 800 lines away could
invalidate a recorded ratio with nothing failing.
`scripts/check-css-color-tokens.ts`, run from `scripts/check-invariants.sh`,
rejects a raw hex outside `:root`; comments, `url("data:…")` payloads — a data
URI cannot read a custom property — and the mask stop listed in its exemption
array are the only exceptions. Organizer-supplied brand colours are data, not
design tokens, and stay in `src/shared/lib/brand-color.ts`.

## Type floor

Meaningful interface copy starts at `--text-xs` (12px). Data tables locally
promote compact steps to `--text-table` (13px). The only 10px exceptions are six
decorative labels inside the scaled landing-page product miniature; the
repository invariant checks their exact selectors and rejects other CSS or
inline values below the floor.
