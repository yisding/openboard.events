/**
 * How the reviewer queue moves. Both rules are pure so they can be checked
 * without a browser — getting either wrong wastes a reviewer's afternoon in a
 * way no type catches.
 */

/**
 * Which criterion a number key fills: the first one still blank, so pressing
 * `4 5` down a two-criterion round scores it in reading order. Once every
 * criterion has a value the keys revise the first, rather than doing nothing.
 */
export function nextCriterionToScore<T extends { id: string }>(
  criteria: readonly T[],
  scores: Record<string, number>,
): T | undefined {
  return criteria.find((criterion) => typeof scores[criterion.id] !== "number") ?? criteria[0];
}

/**
 * What "Save & next" opens: the next proposal that still needs a verdict, in
 * queue order, wrapping past the one just saved. Advancing to the neighbour
 * regardless would walk a reviewer back through work they had finished.
 *
 * "Finished" is `scoredAt`, not "has a number" (M50): a round whose criteria are
 * all written feedback produces completed reviews with no score at all, and
 * those must not be offered back to the reviewer as unfinished work.
 */
export function nextUnscored<T extends { submissionId: string; scoredAt: string | null }>(
  rows: readonly T[],
  justSavedId: string,
): T | undefined {
  const index = rows.findIndex((row) => row.submissionId === justSavedId);
  const ordered = index < 0 ? rows : [...rows.slice(index + 1), ...rows.slice(0, index)];
  return ordered.find((row) => row.scoredAt === null);
}
