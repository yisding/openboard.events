import type { RoomDeletionImpact } from "../schemas";

/** What the room-delete confirm knows about the room while the dialog is open. */
export type RoomDeletionImpactState =
  | { status: "loading" }
  | { status: "ready"; impact: RoomDeletionImpact }
  | { status: "unavailable" };

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * The one sentence that turns "sessions in this room lose their room
 * assignment" into a decision the organizer can actually make (#622, D4).
 *
 * Every branch is spelled out rather than collapsed into a template with
 * pluralized fragments, because each one is a materially different warning:
 * an empty room is a free action, an unpublished room is reversible in private,
 * and a room full of published sessions sends mail to real speakers the moment
 * the button is pressed. The read can also fail — the deletion is still allowed
 * then, but the copy must not imply a count it does not have.
 */
export function roomDeletionImpactCopy(state: RoomDeletionImpactState): string {
  if (state.status === "loading") return "Checking what is scheduled in this room…";
  if (state.status === "unavailable") return "What is scheduled in this room could not be checked just now, so this delete may affect more than you expect.";
  const { sessions, publishedSessions, speakers } = state.impact;
  if (sessions === 0) return "Nothing is scheduled in this room, so nothing else changes.";
  const placed = sessions === 1 ? "1 session loses its room." : `${sessions} sessions lose their room.`;
  if (publishedSessions === 0) {
    return `${placed} ${sessions === 1 ? "It is not published" : "None of them are published"}, so no one is emailed.`;
  }
  const published = publishedSessions === sessions
    ? (sessions === 1 ? "It is published" : "All of them are published")
    : `${publishedSessions} of them ${publishedSessions === 1 ? "is" : "are"} published`;
  if (speakers === 0) return `${placed} ${published}, but no speakers are assigned, so no one is emailed.`;
  return `${placed} ${published}, so ${count(speakers, "speaker", "speakers")} will be emailed that the schedule changed.`;
}

export function restoreVocabItemAtIndex<T extends { id: string }>(current: readonly T[], item: T, originalIndex: number): T[] {
  if (current.some((candidate) => candidate.id === item.id)) return [...current];
  const restored = [...current];
  restored.splice(Math.max(0, Math.min(originalIndex, restored.length)), 0, item);
  return restored;
}

export function restoreFailedVocabDeletion<T extends { id: string }>(
  current: readonly T[],
  removed: T,
  originalIndex: number,
  latestPersisted: T | undefined,
): T[] {
  return restoreVocabItemAtIndex(current, latestPersisted ?? removed, originalIndex);
}

export function canDeleteVocabItem(reorderPending: boolean): boolean {
  return !reorderPending;
}

/** Restore the last persisted relative order without discarding rows added,
 * deleted, or edited while the reorder request was in flight. */
export function restoreVocabOrder<T extends { id: string }>(current: readonly T[], persistedIds: readonly string[]): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  const restored = persistedIds.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    byId.delete(id);
    return [item];
  });
  return [...restored, ...current.filter((item) => byId.has(item.id))];
}
