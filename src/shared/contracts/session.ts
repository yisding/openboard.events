import { z } from "zod";
import { sessionStatusSchema, submissionStatusSchema } from "./enums";
import { contactIdSchema, formatIdSchema, roomIdSchema, sessionIdSchema, submissionIdSchema, trackIdSchema } from "./ids";

/**
 * The abstract a session was promoted from, as that abstract stands *now*.
 *
 * `null` for a session created straight in the agenda — a keynote, a break, a
 * sponsor slot — which owns its own title and can never diverge from anything.
 *
 * Two facts about a promoted session are otherwise unknowable in the admin,
 * and both of them make a screen lie. `published_sessions_v` carries a promoted
 * session only while its abstract is `accepted`, so an abstract that leaves
 * that status takes the talk off the public schedule without touching
 * `sessions.status`; and nothing propagates a later abstract title edit to the
 * session row. Carrying the abstract's live status and title on the session is
 * what lets the agenda say so instead of showing a confident "Published".
 */
export const linkedSubmissionSchema = z.object({
  id: submissionIdSchema,
  code: z.int().nonnegative(),
  title: z.string(),
  status: submissionStatusSchema,
});
export type LinkedSubmission = z.infer<typeof linkedSubmissionSchema>;

export const scheduledSessionDtoSchema = z.object({
  id: sessionIdSchema,
  title: z.string(),
  slug: z.string(),
  descriptionHtml: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  trackId: trackIdSchema.nullable(),
  roomId: roomIdSchema.nullable(),
  formatId: formatIdSchema.nullable(),
  status: sessionStatusSchema,
  scheduleRevision: z.int().nonnegative(),
  rowVersion: z.int().positive(),
  speakerIds: z.array(contactIdSchema),
  linkedSubmission: linkedSubmissionSchema.nullable().default(null),
  /**
   * How many people the originating submission said it expects, `null` for a
   * manually created session or one whose abstract never declared a number.
   *
   * It is the *only* audience figure the product stores, and it is what the
   * Auto-place planner already weighs a room's `capacity` against — carrying it
   * on the session is what lets a manual placement (dialog save, grid drop) be
   * warned about the same mismatch instead of only the automatic one.
   *
   * A sibling of `linkedSubmission` rather than a field inside it: this is a
   * number about the *session's* placement, read once and never redisplayed,
   * while `linkedSubmission` is the abstract's own identity as it stands now.
   * Both come off the same abstract row, and the server reads them together.
   */
  expectedAttendance: z.int().nonnegative().nullable().default(null),
});
export type ScheduledSessionDTO = z.infer<typeof scheduledSessionDtoSchema>;

export const conflictDtoSchema = z.object({
  kind: z.enum(["room", "speaker", "track"]),
  severity: z.enum(["error", "warning"]),
  a: sessionIdSchema,
  b: sessionIdSchema,
  subjectId: z.string(),
  overlapStartMs: z.number(),
  overlapEndMs: z.number(),
});
export type ConflictDTO = z.infer<typeof conflictDtoSchema>;

export const agendaPromotionResultItemSchema = z.discriminatedUnion("outcome", [
  z.object({
    submissionId: submissionIdSchema,
    outcome: z.enum(["created", "already_existed"]),
    sessionId: sessionIdSchema,
  }),
  z.object({
    submissionId: submissionIdSchema,
    outcome: z.literal("rejected"),
    code: z.enum(["NOT_FOUND", "VALIDATION", "CONFLICT"]),
    message: z.string().min(1),
  }),
]);
export type AgendaPromotionResultItem = z.infer<typeof agendaPromotionResultItemSchema>;

/** One request stays small enough to finish and report every row promptly. */
export const MAX_BULK_AGENDA_PROMOTIONS = 50;

/** Truthful per-row outcomes for one bounded bulk promotion request. */
export const bulkAgendaPromotionResultSchema = z.object({
  results: z.array(agendaPromotionResultItemSchema),
  created: z.int().nonnegative(),
  alreadyExisted: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
}).superRefine((value, context) => {
  const counts = {
    created: value.results.filter((row) => row.outcome === "created").length,
    alreadyExisted: value.results.filter((row) => row.outcome === "already_existed").length,
    rejected: value.results.filter((row) => row.outcome === "rejected").length,
  };
  for (const key of ["created", "alreadyExisted", "rejected"] as const) {
    if (value[key] !== counts[key]) {
      context.addIssue({ code: "custom", path: [key], message: `${key} does not match the per-row results` });
    }
  }
});
export type BulkAgendaPromotionResult = z.infer<typeof bulkAgendaPromotionResultSchema>;

export const mySessionDtoSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  roomName: z.string().nullable(),
  trackName: z.string().nullable(),
});
export type MySessionDTO = z.infer<typeof mySessionDtoSchema>;

export const publishedSessionDtoSchema = z.object({
  id: sessionIdSchema,
  scheduleRevision: z.int().nonnegative(),
  slug: z.string(),
  title: z.string(),
  descriptionHtml: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  dayKey: z.string(),
  track: z.object({ id: trackIdSchema, name: z.string(), color: z.string() }).nullable(),
  room: z.object({ id: roomIdSchema, name: z.string() }).nullable(),
  format: z.object({ id: formatIdSchema, name: z.string() }).nullable(),
  // M53: full speaker identity on every session reference — job title and
  // company travel with the session so the sessions list and agenda never
  // need a second round trip through the speakers surface to show who's
  // presenting. Profile link is derived client-side from `contactId` +
  // `eventSlug` (same convention every public surface already used before
  // this DTO carried these fields).
  speakers: z.array(z.object({
    contactId: contactIdSchema,
    name: z.string(),
    jobTitle: z.string().nullable(),
    company: z.string().nullable(),
    headshotUrl: z.string().nullable(),
  })),
});
export const publishedScheduleDtoSchema = z.object({
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    accentColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    backgroundUrl: z.string().nullable(),
    // First Fair (design §6.3). The public read every one of the five `/e/`
    // pages and their embeds already perform — `generateMetadata` reads this
    // field off the same fetch rather than opening a second query, and the
    // shell reads it to render the "Sample event" ribbon.
    isDemo: z.boolean().default(false),
  }),
  days: z.array(z.string()),
  sessions: z.array(publishedSessionDtoSchema),
});
export const publishedSpeakerDtoSchema = z.object({
  contactId: contactIdSchema,
  name: z.string(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  bioHtml: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  // M53: a speaker's session references carry the same time/room/track/format
  // identity the sessions list and agenda render, so the speakers list and
  // gallery can show "when and where" without a second published-schedule
  // fetch, and so the three surfaces can never disagree about a shared
  // session's facts.
  sessions: z.array(z.object({
    id: sessionIdSchema,
    slug: z.string(),
    title: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    dayKey: z.string(),
    room: z.object({ id: roomIdSchema, name: z.string() }).nullable(),
    track: z.object({ id: trackIdSchema, name: z.string(), color: z.string() }).nullable(),
    format: z.object({ id: formatIdSchema, name: z.string() }).nullable(),
  })),
});
export const publishedSpeakersDtoSchema = z.object({
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    accentColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    backgroundUrl: z.string().nullable(),
    // First Fair (design §6.3) — see `publishedScheduleDtoSchema`'s twin field.
    isDemo: z.boolean().default(false),
  }),
  speakers: z.array(publishedSpeakerDtoSchema),
});
export type PublishedSessionDTO = z.infer<typeof publishedSessionDtoSchema>;
export type PublishedScheduleDTO = z.infer<typeof publishedScheduleDtoSchema>;
export type PublishedSpeakerDTO = z.infer<typeof publishedSpeakerDtoSchema>;
export type PublishedSpeakersDTO = z.infer<typeof publishedSpeakersDtoSchema>;
