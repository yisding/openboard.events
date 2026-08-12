import { z } from "zod";
import type { CreateSubmissionInput } from "@/shared/contracts";
import {
  LIMITS,
  cleanAnswersSchema,
  contactIdSchema,
  formatIdSchema,
  participantRoleSchema,
  tagIdSchema,
  trackIdSchema,
} from "@/shared/contracts";

/**
 * "Add abstract" — a proposal an organizer types in on somebody's behalf, for
 * the invited keynote that never went through the CFP.
 *
 * The five decision states only: an organizer cannot hand-create a `draft` (that
 * belongs to a speaker who is still filling the form in) or a `withdrawn` row,
 * and both would be dead weight in the table the moment they existed.
 *
 * Split out of `route.ts` so it can be tested directly: a Next route file may
 * only export the HTTP verbs, and the mapping below is the part that regressed
 * (#117) — it used to hardcode `participants: []`.
 */
export const manualAbstractSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.TITLE),
  status: z.enum(["pending", "accept_queue", "decline_queue", "accepted", "declined"]).default("pending"),
  descriptionHtml: z.string().max(100_000).nullable().default(null),
  trackId: trackIdSchema.nullable().default(null),
  formatId: formatIdSchema.nullable().default(null),
  level: z.string().trim().max(120).nullable().default(null),
  language: z.string().trim().max(120).nullable().default(null),
  capacity: z.int().nonnegative().max(1_000_000).nullable().default(null),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  clientSessionId: z.string().trim().max(255).nullable().default(null),
  tagIds: z.array(tagIdSchema).max(50).default([]),
  /**
   * Who is giving the talk (#117). An invited keynote is attributed to a person
   * or it is an orphan row, and this route used to hardcode an empty list — so
   * the one path built for the off-CFP talk could not name its speaker.
   *
   * Contacts only: a participant is a row in `contacts`, so the caller creates
   * the person first (`POST /api/internal/speakers/[eventId]`) and sends the id.
   * `createSubmission` re-checks the exactly-one-primary rule; the refinements
   * here exist to make it a readable 400 rather than a 500 from the writer.
   */
  participants: z.array(z.object({
    contactId: contactIdSchema,
    role: participantRoleSchema.default("speaker"),
    isPrimary: z.boolean(),
  })).max(20).default([])
    .refine(
      (rows) => rows.length === 0 || rows.filter((row) => row.isPrimary).length === 1,
      { message: "Pick exactly one primary speaker" },
    )
    .refine(
      (rows) => new Set(rows.map((row) => row.contactId)).size === rows.length,
      { message: "The same person is listed twice" },
    ),
});

export type ManualAbstractInput = z.infer<typeof manualAbstractSchema>;

/** Manual rows answer no form, so the branded empty array is built once. */
const NO_ANSWERS = cleanAnswersSchema.parse([]);

/**
 * The organizer's typed-in abstract as M18's create input. Nobody submitted it,
 * so there is nobody to confirm to — which is also why the deadline and the
 * per-speaker limit do not apply and no email is sent.
 */
export function toCreateSubmissionInput(input: ManualAbstractInput): CreateSubmissionInput {
  return {
    formId: null,
    formVersion: null,
    source: "manual",
    kind: "abstract",
    initialStatus: input.status,
    submitterContactId: null,
    // `sortOrder` is the order the organizer listed them in; the primary is
    // whichever row says so, not whichever row happens to be first.
    participants: input.participants.map((participant, index) => ({
      contactId: participant.contactId,
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: index,
    })),
    answers: NO_ANSWERS,
    enforce: { deadline: false, limit: false },
    sendConfirmation: false,
    tagIds: input.tagIds,
    fields: {
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      trackId: input.trackId,
      formatId: input.formatId,
      level: input.level,
      language: input.language,
      capacity: input.capacity,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      clientSessionId: input.clientSessionId,
    },
  };
}
