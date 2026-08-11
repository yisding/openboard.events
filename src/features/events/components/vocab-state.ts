export function restoreVocabItemAtIndex<T extends { id: string }>(current: readonly T[], item: T, originalIndex: number): T[] {
  if (current.some((candidate) => candidate.id === item.id)) return [...current];
  const restored = [...current];
  restored.splice(Math.max(0, Math.min(originalIndex, restored.length)), 0, item);
  return restored;
}
