import { withTx } from "@/db/client";
import { updateContactFields } from "@/features/portal";
import { createSubmissionIn, saveDraftAnswers } from "@/features/submissions";
import {
  cleanAnswersSchema,
  formatIdSchema,
  tagIdSchema,
  trackIdSchema,
  type CleanAnswers,
  type ContactId,
  type EventId,
  type FormId,
  type FormSnapshot,
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

export type SaveDraftInput = Omit<SubmitInput, "draftSubmissionId" | "participants">;

/**
 * A mapped answer is a plain string until it is checked. Parsing rather than
 * casting means a form authored to map a free-text field onto track_id fails
 * here instead of writing a broken foreign key.
 */
function brandOrNull<T>(schema: { parse: (value: unknown) => T }, value: string | null | undefined): T | null {
  return value ? schema.parse(value) : null;
}

function sectionSnapshot(snapshot: FormSnapshot, participant: boolean): FormSnapshot {
  return {
    ...snapshot,
    sections: snapshot.sections.filter((section) => (section.key === "participant") === participant),
  };
}

function answersFor(snapshot: FormSnapshot, answers: RawAnswers): RawAnswers {
  const ids = new Set<string>(snapshot.sections.flatMap((section) => section.fields.map((field) => field.id)));
  return Object.fromEntries(Object.entries(answers).filter(([fieldId]) => ids.has(fieldId)));
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

  const abstractSnapshot = sectionSnapshot(rendered, false);
  const participantSnapshot = sectionSnapshot(rendered, true);
  const abstract = runSubmitPipeline(abstractSnapshot, answersFor(abstractSnapshot, input.answers), { participantId: null, requireRequired: true });
  if (!abstract.ok) throw new AppError("VALIDATION", "Some answers need attention", { fieldErrors: abstract.fieldErrors });

  // Each participant's section runs the same pipeline under their own id, so one
  // co-speaker's missing field cannot be attributed to another.
  const perParticipant: CleanAnswers[] = [];
  const topLevelParticipantAnswers = answersFor(participantSnapshot, input.answers);
  const submittedParticipants = input.participants?.length
    ? input.participants
    : [{ contactId: input.contactId, role: "speaker" as const, isPrimary: true, sortOrder: 0, answers: topLevelParticipantAnswers }];
  if (submittedParticipants.some((participant) => participant.contactId !== input.contactId)) {
    throw new AppError("FORBIDDEN", "A public CFP submission can only update the signed-in speaker");
  }

  let profilePatch: ReturnType<typeof deriveMappedFields>["contact"] = {};
  const abstractContext = answersFor(abstractSnapshot, input.answers);
  const participantFieldIds = new Set(participantSnapshot.sections.flatMap((section) => section.fields.map((field) => field.id)));
  for (const participant of submittedParticipants) {
    const raw = answersFor(participantSnapshot, participant.answers ?? (participant.isPrimary ? topLevelParticipantAnswers : {}));
    // Keep the full snapshot while evaluating participant fields: their
    // visibility may depend on an abstract answer from an earlier section.
    // Only participant answers are retained after that evaluation.
    const result = runSubmitPipeline(rendered, { ...abstractContext, ...raw }, { participantId: participant.contactId, requireRequired: true });
    if (!result.ok) throw new AppError("VALIDATION", "Some speaker details need attention", { fieldErrors: result.fieldErrors });
    const participantClean = cleanAnswersSchema.parse(result.clean.filter((answer) => participantFieldIds.has(answer.fieldId)));
    perParticipant.push(participantClean);
    if (participant.isPrimary) profilePatch = deriveMappedFields(participantSnapshot, participantClean).contact;
  }
  const answers = cleanAnswersSchema.parse([...abstract.clean, ...perParticipant.flat()]);

  // Routing stamps on create only; the rules are evaluated against the same
  // visible answers that are about to be stored.
  const routing = applyRouting(await getActiveRoutingRules(input.eventId, input.formId), cleanAnswersToRecord(abstract.clean));
  const mapped = deriveMappedFields(rendered, abstract.clean);

  const participants = submittedParticipants.map((participant) => ({
    contactId: participant.contactId,
    role: participant.role,
    isPrimary: participant.isPrimary,
    sortOrder: participant.sortOrder,
  }));

  return withTx(async (tx) => {
    const created = await createSubmissionIn(tx, input.eventId, {
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

    // Email is the authenticated identity and cannot be changed by a form
    // answer. Commit the remaining profile changes with the submission so a
    // failed profile write cannot leave a partially completed CFP submit.
    const safePatch = { ...profilePatch };
    delete safePatch.email;
    if (Object.keys(safePatch).length > 0) {
      await updateContactFields(tx, input.eventId, input.contactId, safePatch);
    }
    return created;
  });
}

/** Persist incomplete, type-valid answers without enforcing required fields. */
export async function saveCfpDraft(input: SaveDraftInput) {
  const rendered = await getPinnedSnapshot(input.eventId, input.formId, input.formVersion);
  const current = await getCurrentSnapshot(input.eventId, input.formId);
  if (!rendered || !isStructurallyCompatible(rendered, current)) {
    throw new AppError("FORM_VERSION_STALE", "This form changed while you were filling it in", {
      snapshot: current,
      version: current.version,
    });
  }
  const result = runSubmitPipeline(rendered, input.answers, { participantId: null, requireRequired: false });
  if (!result.ok) throw new AppError("VALIDATION", "Some answers need attention", { fieldErrors: result.fieldErrors });
  return saveDraftAnswers(input.eventId, input.contactId, input.formId, rendered.version, result.clean);
}
