"use client";

import type { ReactNode } from "react";

/**
 * M57 — the one checkbox-selection + sticky bulk-action bar pattern, reused
 * identically wherever a list needs it (abstracts' decisions, speakers'
 * bulk email/reminder, a task's assignee nudges). Callers own their own
 * mutations and verb buttons; this owns only the chrome, so "select rows,
 * see a bar, act" looks and behaves the same on every list it appears on.
 *
 * Two independent slots beyond the count:
 * - `actions` renders only while something is selected, before Clear — the
 *   verbs that operate on the checked rows.
 * - `trailing` renders whenever the bar is visible at all, selection or not —
 *   for something like Abstracts' Notify button, which acts on a
 *   server-computed queue rather than the current selection.
 *
 * The bar stays mounted (and hidden) rather than never rendering, matching
 * the row selection state it mirrors — but nothing here forces that; passing
 * `emptyNote` is how a caller keeps it visible with nothing selected.
 */
export function BulkActionBar({
  count,
  onClear,
  actions,
  emptyNote,
  trailing,
}: {
  count: number;
  onClear: () => void;
  actions?: ReactNode;
  /** Shown instead of "N selected" when `count` is 0 — omit to hide the bar entirely at zero. */
  emptyNote?: ReactNode;
  trailing?: ReactNode;
}) {
  if (count === 0 && !emptyNote) return null;
  return (
    <div className="bulk-bar">
      {count > 0
        ? <><span>{count} selected</span>{actions}<button type="button" onClick={onClear}>Clear</button></>
        : emptyNote}
      {trailing}
    </div>
  );
}
