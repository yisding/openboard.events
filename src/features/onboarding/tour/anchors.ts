import type { TourAnchorSpec } from "@/shared/ui/app/guided-tour";

/**
 * First Fair — the closed `data-tour` registry.
 *
 * There is no `data-testid` anywhere in `src/`, and adding a pinned attribute
 * convention is a liability: every entry is a promise that a refactor three
 * milestones from now must keep. So the tour reaches for one only when the two
 * cheaper rungs of the ladder are genuinely unavailable:
 *
 *   1. **An existing semantic class** (`.unscheduled-tray`, `.score-panel`).
 *      Free, already in the stylesheet, and impossible to remove by accident
 *      without noticing.
 *   2. **A role and an accessible name** (`role="dialog"` named "Edit
 *      session"). Also free, and `authenticated-control-names.test.ts` already
 *      freezes most of these strings for accessibility reasons.
 *   3. **`data-tour`** — only for a control that is lazily mounted behind a
 *      boundary, or whose text is duplicated elsewhere on the same screen.
 *
 * Eight entries, each with a reason it could not be one of the first two.
 * `anchor-registry.test.ts` parses all of `src/` and fails `pnpm check` — by
 * name, saying which step will break — if a script anchor stops resolving, if
 * an attribute is left behind with nothing pointing at it, or if a second
 * element claims the same id.
 */
export const TOUR_ANCHOR_IDS = [
  /** AttentionQueue's first row: mounted lazily inside `WidgetBoundary name="attention"`. */
  "dashboard.attention-row",
  /** The first submission row: behind a `QueryBoundary`, and `<tr>` is rendered by the shared DataTable. */
  "abstracts.row",
  /** The decision bar's send control: three sibling buttons, all `Button`, in the same bar. */
  "abstracts.decision-notify",
  /** The Conflicts tab: one of six `role="tab"` buttons whose only distinguishing text is a word plus a count. */
  "agenda.conflicts-tab",
  /** The **tray's** Auto-place: the string "Auto-place" is duplicated in `day-view/unscheduled-panel.tsx`. */
  "agenda.auto-place-tray",
  /** Bulk publish: inside the canonical bulk-selection bar, which only exists while rows are selected. */
  "agenda.publish",
  /** The conditional question in the organizer preview: present only once Format is Workshop. */
  "forms.workshop-duration",
  /** "Open portal as …": inside a speaker detail panel, and its label carries a first name. */
  "speakers.impersonate",
] as const;

export type TourAnchorId = (typeof TOUR_ANCHOR_IDS)[number];

/**
 * A `data-tour` anchor. Each call site is a module constant in `script.ts`,
 * which matters: `useTourAnchor` keys its resolver on the spec's identity, so
 * a spec rebuilt on every render would restart the MutationObserver forever.
 */
export function tourIdAnchor(id: TourAnchorId): TourAnchorSpec {
  return { kind: "tour-id", id };
}

/**
 * Anchors that live inside a native `<dialog>`.
 *
 * `Modal`, `Drawer`, `ConfirmDialog` and `CommandPalette` all use
 * `showModal()`, which paints in the browser's top layer — above every
 * z-index there is. A scrim can therefore never dim one, so a step pointing
 * inside a dialog must set `spotlight: false` and let the dialog's own
 * `::backdrop` do the scrim's job. The coach portals into the dialog element
 * instead of `document.body`, which is the only way its card lands on top.
 *
 * The registry test enforces the pairing in both directions: every step using
 * one of these must set `spotlight: false`, and every entry here must really
 * be rendered by a file that opens a dialog.
 */
export const DIALOG_BOUND_ANCHORS: readonly string[] = [
  /** The decision-email preflight is the `body` of a `ConfirmDialog`. */
  ".decision-email-preflight",
  /** The response-type picker lives in the builder's "Add a question" `Modal`. */
  ".type-grid",
];

/** Every `role="dialog"` anchor is dialog-bound by construction. */
export function anchorIsDialogBound(anchor: TourAnchorSpec | undefined): boolean {
  if (!anchor) return false;
  if (anchor.kind === "role") return anchor.role === "dialog";
  if (anchor.kind === "selector") return DIALOG_BOUND_ANCHORS.includes(anchor.css);
  return false;
}
