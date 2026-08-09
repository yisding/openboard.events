import { createSubmission } from "@/features/submissions";
import {
  cleanAnswersSchema,
  formatIdSchema,
  tagIdSchema,
  trackIdSchema,
  type CleanAnswers,
  type ContactId,
  type EventId,
  type FormId,
  type SubmissionId,
} from "@/shared/contracts";
import { applyRouting, cleanAnswersToRecord } from "@/shared/lib/conditions";
import { AppError } from "@/shared/lib/errors";
import { deriveMappedFields, runSubmitPipeline, type RawAnswers } from "./pipeline";
import { isStructurallyCompatible } from "./snapshot-compat";
import { getActiveRoutingRules, getCurrentSnapshot, getPinnedSnapshot } from "./snapshots";

/**
 * The CFP submit, from a client's raw answers to WS-C's `createSubmission`.
 * This feature contains no submission INSERT: everything here is preparation,
 * and the single owner does the write.
 */
export type SubmitInput = {
  eventId: EventId;
  formId: FormId;
  contactId: ContactId;
  formVersion: number;
  draftSubmissionId?: SubmissionId | null;
  answers: RawAnswers;
  participants?: Array<{ contactId: ContactId; answers?: RawAnswers; role: "speaker" | "co_speaker"; isPrimary: boolean; sortOrder: number }>;
};

/**
 * A mapped answer is a plain string until it is checked. Parsing rather than
 * casting means a form authored to map a free-text field onto track_id fails
 * here instead of writing a broken foreign key.
 */
function brandOrNull<T>(schema: { parse: (value: unknown) => T }, value: string | null | undefined): T | null {
  return value ? schema.parse(value) : null;
}

export async function submitCfpForm(input: SubmitInput) {
  // The version the client rendered decides which snapshot its answers mean.
  const rendered = await getPinnedSnapshot(input.eventId, input.formId, input.formVersion);
  const current = await getCurrentSnapshot(input.eventId, input.formId);

  // Structural drift is the client's problem to recover from, so the fresh
  // snapshot travels with the error rather than making them fetch it.
  if (!rendered || !isStructurallyCompatible(rendered, current)) {
    throw new AppError("FORM_VERSION_STALE", "This form changed while you were filling it in", {
      snapshot: current,
      version: current.version,
    });
  }

  const abstract = runSubmitPipeline(rendered, input.answers, { participantId: null, requireRequired: true });
  if (!abstract.ok) throw new AppError("VALIDATION", "Some answers need attention", { fieldErrors: abstract.fieldErrors });

  // Each participant's section runs the same pipeline under their own id, so one
  // co-speaker's missing field cannot be attributed to another.
  const perParticipant: CleanAnswers[] = [];
  for (const participant of input.participants ?? []) {
    if (!participant.answers) continue;
    const result = runSubmitPipeline(rendered, participant.answers, { participantId: participant.contactId, requireRequired: true });
    if (!result.ok) throw new AppError("VALIDATION", "Some speaker details need attention", { fieldErrors: result.fieldErrors });
    perParticipant.push(result.clean);
  }
  const answers = cleanAnswersSchema.parse([...abstract.clean, ...perParticipant.flat()]);

  // Routing stamps on create only; the rules are evaluated against the same
  // visible answers that are about to be stored.
  const routing = applyRouting(await getActiveRoutingRules(input.eventId, input.formId), cleanAnswersToRecord(abstract.clean));
  const mapped = deriveMappedFields(rendered, abstract.clean);

  const participants = input.participants?.length
    ? input.participants.map((participant) => ({
      contactId: participant.contactId,
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: participant.sortOrder,
    }))
    : [{ contactId: input.contactId, role: "speaker" as const, isPrimary: true, sortOrder: 0 }];

  return createSubmission(input.eventId, {
    formId: input.formId,
    formVersion: rendered.version,
    source: "cfp",
    kind: "abstract",
    submitterContactId: input.contactId,
    ...(input.draftSubmissionId ? { draftSubmissionId: input.draftSubmissionId } : {}),
    fields: {
      title: mapped.submission.title ?? "",
      descriptionHtml: mapped.submission.descriptionHtml ?? null,
      trackId: brandOrNull(trackIdSchema, routing.trackId ?? mapped.submission.trackId),
      formatId: brandOrNull(formatIdSchema, mapped.submission.formatId),
      level: mapped.submission.level ?? null,
    },
    participants,
    answers,
    routing: {
      setTrackId: brandOrNull(trackIdSchema, routing.trackId),
      addTagIds: routing.tagIds.map((tagId) => tagIdSchema.parse(tagId)),
    },
  });
}
