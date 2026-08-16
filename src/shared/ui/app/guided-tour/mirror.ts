"use client";

import type { TourCursor, TourStatus } from "./types";

/**
 * The optimistic cursor mirror.
 *
 * The database row *is* the cursor. This is a copy of the last move this tab
 * made, so a reload that raced the PATCH resumes where the player actually
 * got to instead of one step back.
 *
 * It lives in its own module — rather than as three private functions inside
 * the engine — because dropping it is not the engine's decision alone. Any
 * control that moves the cursor deliberately (the demo ribbon's "Restart
 * tour", the palette's tour entries) is stating that the local record is no
 * longer the furthest the player reached. Leaving it behind is what turns
 * "start over" into "jump straight back to the last step you saw", which on a
 * finished tour means the curtain call's modal `<dialog>` reopening on every
 * load — and a modal dialog blocks the rest of the page, including the ribbon
 * that offered the restart.
 */
const STORAGE_PREFIX = "openboard:tour:";

const MIRRORED_STATUSES: readonly string[] = ["not_started", "active", "paused", "complete"];

export type MirroredCursor = { stepId: string; chapter: string; status: TourStatus };

function isTourStatus(value: unknown): value is TourStatus {
  return typeof value === "string" && MIRRORED_STATUSES.includes(value);
}

/**
 * The mirror, or `null` when there is none, storage is unavailable, or what is
 * stored is not a cursor this engine version understands. The status is
 * validated rather than cast: it decides whether a tour runs at all, and a
 * value from a future (or corrupted) write must not become a fifth state.
 */
export function readTourMirror(scopeId: string): MirroredCursor | null {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scopeId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { stepId, chapter, status } = parsed as Partial<MirroredCursor>;
    if (typeof stepId !== "string" || typeof chapter !== "string" || !isTourStatus(status)) return null;
    return { stepId, chapter, status };
  } catch {
    return null;
  }
}

export function writeTourMirror(scopeId: string, cursor: TourCursor): void {
  try {
    const mirror: MirroredCursor = { stepId: cursor.stepId, chapter: cursor.chapter, status: cursor.status };
    window.localStorage.setItem(`${STORAGE_PREFIX}${scopeId}`, JSON.stringify(mirror));
  } catch {
    // A browser with storage disabled loses the optimistic mirror and nothing
    // else: the database row is the cursor, and it is still there.
  }
}

/** Drops the mirror for a scope. Safe to call when there is none. */
export function forgetTourMirror(scopeId: string): void {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${scopeId}`);
  } catch {
    // Same trade as `writeTourMirror`: storage is a convenience, never a source
    // of truth, so failing to clear it can never fail the caller's action.
  }
}
