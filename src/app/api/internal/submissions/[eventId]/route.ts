import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { createSubmission, listSubmissions, submissionFiltersSchema } from "@/features/submissions";
import {
  LIMITS,
  cleanAnswersSchema,
  eventIdSchema,
  formatIdSchema,
  tagIdSchema,
  trackIdSchema,
} from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The organizer Abstracts table's rows. Reviewers use the evaluation queue,
 * whose server query applies their plan and assignment scope.
 */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: submissionFiltersSchema,
  handler: async ({ eventId, input }) => listSubmissions(eventIdSchema.parse(eventId), input),
});

/**
 * "Add abstract" — a proposal an organizer types in on somebody's behalf, for
 * the invited keynote that never went through the CFP.
 *
 * The five decision states only: an organizer cannot hand-create a `draft` (that
 * belongs to a speaker who is still filling the form in) or a `withdrawn` row,
 * and both would be dead weight in the table the moment they existed.
 */
const manualAbstractSchema = z.object({
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
});

/** Manual rows answer no form, so the branded empty array is built once. */
const NO_ANSWERS = cleanAnswersSchema.parse([]);

/**
 * Delegates to M18's `createSubmission` — this route allocates no code and
 * writes no row itself. The repository has exactly one submission-insert site
 * and it is not here (resolution #8).
 */
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: manualAbstractSchema,
  handler: async ({ eventId, input }) => createSubmission(eventIdSchema.parse(eventId), {
    formId: null,
    formVersion: null,
    source: "manual",
    kind: "abstract",
    initialStatus: input.status,
    // Nobody submitted this, so there is nobody to confirm to — which is also
    // why the deadline and per-speaker limit do not apply and no email is sent.
    submitterContactId: null,
    participants: [],
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
  }),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return create(request, route);
}
