/**
 * M51 — the contact fields a speaker-roster CSV column may be mapped onto.
 * Its own tiny module (rather than living inline in `speaker-roster.ts` or
 * `speaker-csv.ts`) because both the contracts layer (validation schemas)
 * and the pure parser in `src/features/portal/server/speaker-csv.ts` need
 * the same list, and contracts must not import from `features`.
 *
 * Deliberately a subset of `ContactPatch`: identity + the profile fields an
 * organizer typically already has in a spreadsheet. Rich text (bio) and
 * files (headshot) are edited in the speaker editor, not imported as CSV
 * text.
 */
export const SPEAKER_CSV_FIELDS = ["firstName", "lastName", "jobTitle", "company", "linkedinUrl", "twitterUrl", "websiteUrl"] as const;
export type SpeakerCsvField = (typeof SPEAKER_CSV_FIELDS)[number];
