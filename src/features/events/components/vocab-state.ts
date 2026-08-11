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
