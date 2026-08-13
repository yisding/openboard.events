import type { ConflictDTO, ScheduledSessionDTO } from "@/shared/contracts";

export type BulkPublishPreflight = {
  candidates: ScheduledSessionDTO[];
  unscheduled: ScheduledSessionDTO[];
  emailFanout: number;
  conflictCount: number;
};

export function bulkPublishFailureMessage(
  published: boolean,
  serverMessage?: string,
): string {
  const outcome = published
    ? "those sessions were published or all speaker emails were queued"
    : "those sessions were unpublished";
  const retryState = published ? "drafts" : "published";
  const lead = serverMessage?.trim() || `We couldn’t confirm whether ${outcome}.`;
  const punctuation = /[.!?]$/u.test(lead) ? "" : ".";
  return `${lead}${punctuation} The agenda was refreshed; retry only sessions still shown as ${retryState}.`;
}

/**
 * Summarize the exact side effects of publishing the current selection.
 *
 * Already-published rows are not candidates, speaker mail is counted per
 * session assignment (one speaker on two sessions receives two schedule
 * messages), and conflicts remain advisory: organizers see the count without
 * losing the product's deliberate ability to publish through warnings.
 */
export function bulkPublishPreflight(
  selected: readonly ScheduledSessionDTO[],
  conflicts: readonly ConflictDTO[],
): BulkPublishPreflight {
  const candidates = selected.filter((session) => session.status !== "published");
  const unscheduled = candidates.filter((session) => session.startsAt === null || session.endsAt === null);
  const candidateIds = new Set(candidates.map((session) => String(session.id)));
  const relatedConflicts = new Set<string>();

  for (const conflict of conflicts) {
    if (!candidateIds.has(String(conflict.a)) && !candidateIds.has(String(conflict.b))) continue;
    const [a, b] = String(conflict.a).localeCompare(String(conflict.b)) <= 0
      ? [String(conflict.a), String(conflict.b)]
      : [String(conflict.b), String(conflict.a)];
    relatedConflicts.add(`${conflict.kind}:${conflict.subjectId}:${a}:${b}`);
  }

  return {
    candidates,
    unscheduled,
    emailFanout: candidates
      .filter((session) => session.startsAt !== null && session.endsAt !== null)
      .reduce((total, session) => total + session.speakerIds.length, 0),
    conflictCount: relatedConflicts.size,
  };
}
