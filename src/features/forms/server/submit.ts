import { and, eq } from "drizzle-orm";
import { db, withTx, type TxDb } from "@/db/client";
import { contacts, forms, submissions } from "@/db/schema";
import { getOrCreateContact, updateContactFields } from "@/features/event-contacts";
import {
  cleanAnswersSchema,
  formatIdSchema,
  tagIdSchema,
  trackIdSchema,
  type CleanAnswers,
  type ContactId,
  type CreateSubmissionInput,
  type CreateSubmissionResult,
  type DraftParticipantInput,
  type EventId,
  type FormId,
  type FormSnapshot,
  type ParticipantRole,
  type SubmissionId,
  type SubmissionStatus,
  submissionIdSchema,
} from "@/shared/contracts";
import { applyRouting, cleanAnswersToRecord } from "@/shared/lib/conditions";
import { AppError } from "@/shared/lib/errors";
import { scopeParticipantFieldErrors } from "../participant-errors";
import { enabledSecondaryParticipantRoles, type SecondaryParticipantRole } from "../participant-roles";
import { deriveMappedFields, runSubmitPipeline, type RawAnswers } from "./pipeline";
import { isStructurallyCompatible } from "./snapshot-compat";
import { getActiveRoutingRules, getCurrentSnapshot, getPinnedSnapshot } from "./snapshots";

/**
 * The CFP submit, from a client's raw answers to WS-C's `createSubmission`.
 * This feature contains no submission INSERT: everything here is preparation,
 * and the single owner does the write.
 */
export type ParticipantInput = {
  clientId: string;
  email: string;
  answers?: RawAnswers;
  role: ParticipantRole;
  isPrimary: boolean;
  sortOrder: number;
};

export type SubmitInput = {
  eventId: EventId;
  formId: FormId;
  contactId: ContactId;
  formVersion: number;
  draftSubmissionId?: SubmissionId | null;
  answers: RawAnswers;
  participants?: ParticipantInput[];
};

export type SaveDraftInput = Omit<SubmitInput, "draftSubmissionId">;

/** Submission persistence port wired by the top-level CFP composition feature. */
export type CfpSubmissionCommands = {
  createSubmissionIn: (tx: TxDb, eventId: EventId, input: CreateSubmissionInput) => Promise<CreateSubmissionResult>;
  lockSubmissionLimitScopeIn: (tx: TxDb, eventId: EventId, formId: FormId, contactId: ContactId) => Promise<void>;
  saveDraftAnswers: (
    eventId: EventId,
    contactId: ContactId,
    formId: FormId,
    formVersion: number,
    answers: CleanAnswers,
    participants?: DraftParticipantInput[],
  ) => Promise<{ submissionId: SubmissionId; saved: boolean }>;
};

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

function committedResult(row: { id: string; code: number; status: SubmissionStatus }): CreateSubmissionResult {
  return {
    submissionId: submissionIdSchema.parse(row.id),
    code: row.code,
    status: row.status,
    promotedFromDraft: true,
  };
}

function assertParticipantRolePolicy(
  participants: ReadonlyArray<{ role: ParticipantRole; isPrimary: boolean }>,
  enabledSecondaryRoles: ReadonlySet<SecondaryParticipantRole>,
): void {
  const primary = participants.filter((participant) => participant.isPrimary);
  if (primary.length !== 1 || primary[0]?.role !== "speaker") {
    throw new AppError("VALIDATION", "A submission needs exactly one primary speaker");
  }
  for (const participant of participants) {
    if (participant.isPrimary) continue;
    if (participant.role === "speaker") {
      throw new AppError("VALIDATION", "Only the primary participant can have the speaker role");
    }
    if (!enabledSecondaryRoles.has(participant.role)) {
      throw new AppError("VALIDATION", `The ${participant.role.replaceAll("_", "-")} role is not enabled for this form`);
    }
  }
}

export async function submitCfpForm(
  input: SubmitInput,
  commands: Pick<CfpSubmissionCommands, "createSubmissionIn" | "lockSubmissionLimitScopeIn">,
): Promise<CreateSubmissionResult> {
  if (input.draftSubmissionId) {
    // A committed draft is the idempotency record. Bind it to all three owners
    // before consulting mutable form state, so a lost-response retry still
    // succeeds after an organizer publishes a new form version.
    const [claimedDraft] = await db.select({
      id: submissions.id,
      formId: submissions.formId,
      submitterContactId: submissions.submitterContactId,
      code: submissions.code,
      status: submissions.status,
    }).from(submissions).where(and(
      eq(submissions.id, input.draftSubmissionId),
      eq(submissions.eventId, input.eventId),
    )).limit(1);
    if (!claimedDraft || claimedDraft.formId !== input.formId || claimedDraft.submitterContactId !== input.contactId) {
      throw new AppError("NOT_FOUND", "Draft not found");
    }
    if (claimedDraft.status !== "draft") return committedResult(claimedDraft);
  }

  // The version the client rendered decides which snapshot its answers mean.
  const [rendered, current, formRows] = await Promise.all([
    getPinnedSnapshot(input.eventId, input.formId, input.formVersion),
    getCurrentSnapshot(input.eventId, input.formId),
    db.select({ kind: forms.kind, collectParticipants: forms.collectParticipants, participantRoles: forms.participantRoles })
      .from(forms)
      .where(and(eq(forms.eventId, input.eventId), eq(forms.id, input.formId)))
      .limit(1),
  ]);
  const form = formRows[0];
  if (!form) throw new AppError("NOT_FOUND", "Form not found");

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
  const topLevelParticipantAnswers = answersFor(participantSnapshot, input.answers);
  const submittedParticipants: Array<{
    clientId: string;
    email: string | null;
    contactId: ContactId | null;
    answers?: RawAnswers;
    role: ParticipantRole;
    isPrimary: boolean;
    sortOrder: number;
  }> = form.collectParticipants && input.participants?.length
    ? input.participants.map((participant) => ({ ...participant, email: participant.email.trim().toLowerCase(), contactId: null }))
    : [{ clientId: input.contactId, email: null, contactId: input.contactId, role: "speaker", isPrimary: true, sortOrder: 0, answers: topLevelParticipantAnswers }];

  const enabledSecondaryRoles = new Set(enabledSecondaryParticipantRoles(form.participantRoles));
  assertParticipantRolePolicy(submittedParticipants, enabledSecondaryRoles);
  if (new Set(submittedParticipants.map((participant) => participant.clientId)).size !== submittedParticipants.length) {
    throw new AppError("VALIDATION", "Participant client IDs must be unique");
  }
  const emails = submittedParticipants.flatMap((participant) => participant.email ? [participant.email] : []);
  if (new Set(emails).size !== emails.length) {
    throw new AppError("VALIDATION", "Participant emails must be unique");
  }

  const preparedParticipants: Array<typeof submittedParticipants[number] & {
    clean: CleanAnswers;
    profilePatch: ReturnType<typeof deriveMappedFields>["contact"];
  }> = [];
  const abstractContext = answersFor(abstractSnapshot, input.answers);
  const participantFieldIds = new Set(participantSnapshot.sections.flatMap((section) => section.fields.map((field) => field.id)));
  const participantEmailFieldIds = new Set(participantSnapshot.sections.flatMap((section) =>
    section.fields.filter((field) => field.mapsTo === "contact.email").map((field) => field.id)));
  if (form.collectParticipants) {
    for (const participant of submittedParticipants) {
      const raw = answersFor(participantSnapshot, participant.answers ?? (participant.isPrimary ? topLevelParticipantAnswers : {}));
      // Keep the full snapshot while evaluating participant fields: their
      // visibility may depend on an abstract answer from an earlier section.
      // Only participant answers are retained after that evaluation.
      const result = runSubmitPipeline(rendered, { ...abstractContext, ...raw }, { participantId: participant.clientId, requireRequired: true });
      if (!result.ok) {
        throw new AppError("VALIDATION", "Some speaker details need attention", {
          fieldErrors: participant.isPrimary
            ? result.fieldErrors
            : scopeParticipantFieldErrors(participant.clientId, result.fieldErrors),
        });
      }
      const participantClean = cleanAnswersSchema.parse(result.clean.filter((answer) => participantFieldIds.has(answer.fieldId)));
      preparedParticipants.push({
        ...participant,
        clean: participantClean,
        profilePatch: deriveMappedFields(participantSnapshot, participantClean).contact,
      });
    }
  } else {
    const noAnswers = cleanAnswersSchema.parse([]);
    preparedParticipants.push(...submittedParticipants.map((participant) => ({
      ...participant,
      clean: noAnswers,
      profilePatch: {},
    })));
  }
  const clientAnswers = cleanAnswersSchema.parse([...abstract.clean, ...preparedParticipants.flatMap((participant) => participant.clean)]);

  // Routing stamps on create only; the rules are evaluated against the same
  // visible answers that are about to be stored.
  // Only the abstract section's answers are in scope here, so a rule sourced
  // from a participant question can never be evaluated — the editor offers
  // those fields, so such rules exist. Pass the evaluable set explicitly and
  // let `applyRouting` skip anything it cannot answer.
  const routableFieldIds = new Set<string>(
    sectionSnapshot(rendered, false).sections.flatMap((section) => section.fields.map((field) => field.id)),
  );
  const routing = applyRouting(
    await getActiveRoutingRules(input.eventId, input.formId),
    cleanAnswersToRecord(abstract.clean),
    routableFieldIds,
  );
  const mapped = deriveMappedFields(rendered, abstract.clean);

  return withTx(async (tx) => {
    // Lock this speaker/form invariant before draft or contact rows. Every CFP
    // final-submit path uses this order, while unrelated speakers acquire
    // different rows and proceed independently.
    await commands.lockSubmissionLimitScopeIn(tx, input.eventId, input.formId, input.contactId);

    if (input.draftSubmissionId) {
      // Recheck after the scope lock before participant side effects. A
      // lost-response retry must return the committed result without applying
      // a changed payload, and a caller cannot borrow another speaker's
      // submitted UUID as an idempotency key.
      const [draft] = await tx.select({
        id: submissions.id,
        formId: submissions.formId,
        submitterContactId: submissions.submitterContactId,
        code: submissions.code,
        status: submissions.status,
      }).from(submissions).where(and(
        eq(submissions.id, input.draftSubmissionId),
        eq(submissions.eventId, input.eventId),
      )).limit(1);
      if (!draft || draft.formId !== input.formId || draft.submitterContactId !== input.contactId) {
        throw new AppError("NOT_FOUND", "Draft not found");
      }
      if (draft.status !== "draft") {
        return committedResult(draft);
      }
    }

    // Public participant identifiers exist only in the browser. Resolve every
    // email here, in the same transaction as the submission, then remap answer
    // ownership to contact IDs for createSubmissionIn's participant map.
    const contactIds = new Map<string, ContactId>();
    const canonicalEmails = new Map<string, string>();
    const seenContacts = new Set<string>();
    const participants: Array<{
      contactId: ContactId;
      role: ParticipantRole;
      isPrimary: boolean;
      sortOrder: number;
    }> = [];
    for (const participant of preparedParticipants) {
      let contactId = participant.contactId;
      if (!contactId) {
        if (!participant.email) throw new AppError("INTERNAL", "Participant email was not resolved");
        contactId = await getOrCreateContact(tx, input.eventId, participant.email);
      }
      let canonicalEmail = participant.email;
      if (!canonicalEmail) {
        const [contact] = await tx.select({ email: contacts.email }).from(contacts).where(and(
          eq(contacts.eventId, input.eventId),
          eq(contacts.id, contactId),
        )).limit(1);
        if (!contact) throw new AppError("NOT_FOUND", "Contact not found");
        canonicalEmail = contact.email.trim().toLowerCase();
      }
      if (participant.isPrimary && contactId !== input.contactId) {
        throw new AppError("FORBIDDEN", "The primary participant must be the signed-in speaker");
      }
      if (seenContacts.has(contactId)) {
        throw new AppError("VALIDATION", "Each participant email must resolve to a different contact");
      }
      seenContacts.add(contactId);
      contactIds.set(participant.clientId, contactId);
      canonicalEmails.set(participant.clientId, canonicalEmail);
      participants.push({
        contactId,
        role: participant.role,
        isPrimary: participant.isPrimary,
        sortOrder: participant.sortOrder,
      });

      // Email is explicit identity data, not an answer-mapped profile update.
      const safePatch = { ...participant.profilePatch };
      if (safePatch.email && safePatch.email.trim().toLowerCase() !== canonicalEmail) {
        throw new AppError("VALIDATION", "Participant email answer must match the participant email");
      }
      delete safePatch.email;
      // A submitter may invite a co-speaker by email, but that does not grant
      // permission to overwrite an existing contact's profile. Their supplied
      // answers remain attached to this submission for later review; only the
      // authenticated primary speaker can write through to their contact row.
      if (participant.isPrimary && Object.keys(safePatch).length > 0) {
        await updateContactFields(tx, input.eventId, contactId, safePatch);
      }
    }
    const answers = cleanAnswersSchema.parse(clientAnswers.map((answer) => {
      if (!answer.participantId) return answer;
      const contactId = contactIds.get(answer.participantId);
      if (!contactId) throw new AppError("INTERNAL", "Participant answer was not resolved");
      if (participantEmailFieldIds.has(answer.fieldId)) {
        const canonicalEmail = canonicalEmails.get(answer.participantId);
        if (!canonicalEmail) throw new AppError("INTERNAL", "Participant email was not resolved");
        return { ...answer, participantId: contactId, value: { t: "s" as const, v: canonicalEmail } };
      }
      return { ...answer, participantId: contactId };
    }));

    const created = await commands.createSubmissionIn(tx, input.eventId, {
      formId: input.formId,
      formVersion: rendered.version,
      source: "cfp",
      kind: form.kind,
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
    return created;
  });
}

/** Persist incomplete, type-valid answers without enforcing required fields. */
export async function saveCfpDraft(
  input: SaveDraftInput,
  commands: Pick<CfpSubmissionCommands, "saveDraftAnswers">,
) {
  const [rendered, current, formRows] = await Promise.all([
    getPinnedSnapshot(input.eventId, input.formId, input.formVersion),
    getCurrentSnapshot(input.eventId, input.formId),
    db.select({ collectParticipants: forms.collectParticipants, participantRoles: forms.participantRoles })
      .from(forms)
      .where(and(eq(forms.eventId, input.eventId), eq(forms.id, input.formId)))
      .limit(1),
  ]);
  const form = formRows[0];
  if (!form) throw new AppError("NOT_FOUND", "Form not found");
  if (!rendered || !isStructurallyCompatible(rendered, current)) {
    throw new AppError("FORM_VERSION_STALE", "This form changed while you were filling it in", {
      snapshot: current,
      version: current.version,
    });
  }
  const result = runSubmitPipeline(rendered, input.answers, { participantId: null, requireRequired: false });
  if (!result.ok) throw new AppError("VALIDATION", "Some answers need attention", { fieldErrors: result.fieldErrors });
  const participantSnapshot = sectionSnapshot(rendered, true);
  const abstractContext = answersFor(sectionSnapshot(rendered, false), input.answers);
  const participantFieldIds = new Set(participantSnapshot.sections.flatMap((section) => section.fields.map((field) => field.id)));
  const draftParticipants: DraftParticipantInput[] = [];
  const enabledSecondaryRoles = new Set(enabledSecondaryParticipantRoles(form.participantRoles));
  const submittedDraftParticipants = form.collectParticipants ? (input.participants ?? []) : [];
  for (const participant of submittedDraftParticipants) {
    if (participant.isPrimary || participant.role === "speaker") {
      throw new AppError("VALIDATION", "Draft participant entries must use an additional participant role");
    }
    if (!enabledSecondaryRoles.has(participant.role)) {
      throw new AppError("VALIDATION", `The ${participant.role.replaceAll("_", "-")} role is not enabled for this form`);
    }
    const participantResult = runSubmitPipeline(
      rendered,
      { ...abstractContext, ...answersFor(participantSnapshot, participant.answers ?? {}) },
      { participantId: participant.clientId, requireRequired: false },
    );
    if (!participantResult.ok) {
      throw new AppError("VALIDATION", "Some speaker details need attention", {
        fieldErrors: scopeParticipantFieldErrors(participant.clientId, participantResult.fieldErrors),
      });
    }
    draftParticipants.push({
      clientId: participant.clientId,
      email: participant.email,
      role: participant.role,
      isPrimary: false,
      sortOrder: participant.sortOrder,
      answers: cleanAnswersSchema.parse(participantResult.clean.filter((answer) => participantFieldIds.has(answer.fieldId))),
    });
  }
  const answers = cleanAnswersSchema.parse([
    ...result.clean,
    ...(submittedDraftParticipants.length > 0 ? draftParticipants.flatMap((participant) => participant.answers) : []),
  ]);
  return commands.saveDraftAnswers(
    input.eventId,
    input.contactId,
    input.formId,
    rendered.version,
    answers,
    input.participants || !form.collectParticipants ? draftParticipants : undefined,
  );
}
