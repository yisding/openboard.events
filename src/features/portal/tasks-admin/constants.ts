/**
 * Client-safe tasks-admin constants. The file-request editor prefills its
 * extension list from this, and `server/mutations.ts` uses it as the zod
 * default — but that module reaches the database (and, via `server/queries.ts`,
 * `next/headers`), so the constant lives here and is re-exported there rather
 * than the other way round.
 */
export const DEFAULT_ACCEPTED_EXTENSIONS = ["pdf", "ppt", "pptx", "key", "zip", "png", "jpg", "jpeg"] as const;
