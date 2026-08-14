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

`StatusBadge` accepts only the keys in `STATUS_BADGES`. A new backend enum must
therefore receive an explicit label and tone before it can render. The component
emits only `.status-tone-*` classes, and its unit test verifies every emitted
class has a stylesheet rule.

## Type floor

Meaningful interface copy starts at `--text-xs` (12px). Data tables locally
promote compact steps to `--text-table` (13px). The only 10px exceptions are six
decorative labels inside the scaled landing-page product miniature; the
repository invariant checks their exact selectors and rejects other CSS or
inline values below the floor.
