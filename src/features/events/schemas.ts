import { z } from "zod";
import { eventIdSchema, LIMITS, plainTextLength } from "@/shared/contracts";

/**
 * Pure zod schemas + small constants for the events feature. This file has no
 * server imports (no `@/db/client`, no drizzle) so client components can import
 * it directly for `zodResolver` without pulling database code into the browser
 * bundle — only `index.ts` (the server barrel) and `index.client.ts` do that
 * split; this module is safe from either side.
 */

export const EVENT_TYPES = ["conference", "summit", "workshop", "meetup", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const optionalUrl = z.union([z.url(), z.literal("")]).optional();
const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * The theme field is plain text, but the "N / 1000" counter and the server
 * rejection both go through the one shared `plainTextLength` helper (tag-
 * stripped code points) rather than `.length` — the same rule the rich-text
 * fields use, so a future switch to HTML theming does not silently change
 * what "1000 characters" means.
 */
const themeText = z.string().trim().max(4000)
  .refine((value) => plainTextLength(value) <= LIMITS.THEME, { message: `Theme must be ${LIMITS.THEME} characters or fewer` });

/**
 * `startsAt`/`endsAt` arrive as UTC ISO instants: the Details form binds
 * `<DateTimePicker tz={timezone}>`, which is the sole call site of
 * `zonedInputToUtc` for this feature (it lives in `shared/ui/app/datetime-picker`
 * and imports only from `time.ts`, per the date-library invariant). The server
 * therefore never re-derives a local-to-UTC conversion; it only compares two
 * already-UTC instants and stores them.
 */
export const createEventInputSchema = z.object({
  // Callers that need retry-safe creation generate this once and replay it.
  // Legacy callers may omit it and retain the server-generated id behavior.
  id: eventIdSchema.optional(),
  name: z.string().trim().min(1, "Event name is required").max(200),
  slug: z.string().trim().max(200).optional(),
  eventType: z.enum(EVENT_TYPES).default("conference"),
  websiteUrl: optionalUrl,
  location: optionalText(500),
  timezone: z.string().trim().min(1, "Timezone is required"),
  startsAt: z.iso.datetime({ message: "Starts At must be a valid date/time" }),
  endsAt: z.iso.datetime({ message: "Ends At must be a valid date/time" }),
  theme: themeText.optional(),
  physicalAddress: optionalText(500),
}).refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
  message: "Ends At must be after Starts At",
  path: ["endsAt"],
});
export type CreateEventInput = z.infer<typeof createEventInputSchema>;

/**
 * The Details tab's patch. `startsAt`/`endsAt`/`timezone` are a bundle — the
 * client always sends all three together when either datetime changes, so the
 * server can validate the pair without guessing which value is stale.
 */
export const eventDetailsPatchSchema = z.object({
  name: z.string().trim().min(1, "Event name is required").max(200).optional(),
  slug: z.string().trim().min(1).max(200).optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  websiteUrl: optionalUrl,
  location: optionalText(500),
  timezone: z.string().trim().min(1).optional(),
  startsAt: z.iso.datetime({ message: "Starts At must be a valid date/time" }).optional(),
  endsAt: z.iso.datetime({ message: "Ends At must be a valid date/time" }).optional(),
  theme: themeText.nullable().optional(),
  physicalAddress: optionalText(500),
  logoFileId: z.uuid().nullable().optional(),
  backgroundFileId: z.uuid().nullable().optional(),
}).refine((value) => !(value.startsAt && value.endsAt) || new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
  message: "Ends At must be after Starts At",
  path: ["endsAt"],
});
export type UpdateEventInput = z.infer<typeof eventDetailsPatchSchema>;

export const updateEventBodySchema = z.object({
  expectedRowVersion: z.int().positive(),
  patch: eventDetailsPatchSchema,
});

export const VOCAB_KINDS = ["tracks", "rooms", "formats", "tags"] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];
export const vocabKindSchema = z.enum(VOCAB_KINDS);

const hexColor = z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Color must be a hex value like #00a878");

export const trackInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  color: hexColor.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});
export const roomInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  capacity: z.int().min(0).nullable().optional(),
});
export const formatInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  defaultDurationMins: z.int().min(5).max(600).optional(),
});
export const tagInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
});

/**
 * The create route shape: a superset of every kind's fields, with `name`
 * required. The PATCH variant below makes those fields optional, and both
 * server mutations re-validate against the kind-specific schema before they
 * touch the database.
 */
export const vocabItemInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Name is required").max(200),
  color: hexColor.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  capacity: z.int().min(0).nullable().optional(),
  defaultDurationMins: z.int().min(5).max(600).optional(),
});
export type VocabInput = z.infer<typeof vocabItemInputSchema>;

export const vocabItemPatchSchema = vocabItemInputSchema
  .omit({ id: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "At least one field is required");
export type VocabPatch = z.infer<typeof vocabItemPatchSchema>;

export const reorderVocabBodySchema = z.object({
  orderedIds: z.array(z.uuid()).min(1),
});

/**
 * The room-delete confirm's payload. It lives beside the input schemas rather
 * than in `shared/contracts` because nothing outside the settings dialog reads
 * it: these are three counts computed for one decision, not a shape any other
 * surface renders.
 */
export const roomDeletionImpactSchema = z.object({
  /** Placed in the room, whatever their status — all of them lose the room. */
  sessions: z.int().nonnegative(),
  /** The published, timed subset: the ones whose speakers hold a calendar item naming it. */
  publishedSessions: z.int().nonnegative(),
  /** Distinct people on that subset, each of whom this deletion emails. */
  speakers: z.int().nonnegative(),
});
export type RoomDeletionImpact = z.infer<typeof roomDeletionImpactSchema>;

export function vocabInputSchemaFor(kind: VocabKind) {
  switch (kind) {
    case "tracks": return trackInputSchema;
    case "rooms": return roomInputSchema;
    case "formats": return formatInputSchema;
    case "tags": return tagInputSchema;
  }
}

export function vocabPatchSchemaFor(kind: VocabKind) {
  const fields = vocabInputSchemaFor(kind).omit({ id: true }).partial();
  return fields.refine((patch) => Object.keys(patch).length > 0, "At least one field is required");
}

export const VOCAB_LABELS: Record<VocabKind, string> = {
  tracks: "track",
  rooms: "room",
  formats: "format",
  tags: "tag",
};
