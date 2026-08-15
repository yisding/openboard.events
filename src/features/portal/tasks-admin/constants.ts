/**
 * Client-safe tasks-admin constants. The file-request editor prefills its
 * extension list from this, and `server/mutations.ts` uses it as the zod
 * default — but that module reaches the database (and, via `server/queries.ts`,
 * `next/headers`), so the constant lives here and is re-exported there rather
 * than the other way round.
 */
export const DEFAULT_ACCEPTED_EXTENSIONS = ["pdf", "ppt", "pptx", "key", "zip", "png", "jpg", "jpeg"] as const;

/**
 * The largest size a file request may advertise, in MB.
 *
 * Client-safe half of the upload policy: both the admin card and the speaker's
 * task page render "up to N MB" from a request's `maxSizeMb`, and `FileUpload`
 * uses it to raise its own gate — so the editor must not let an organizer type
 * a number the presign call will refuse. `server/mutations.ts` pins this to
 * `UPLOAD_MAX_SIZE_MB` at compile time; it cannot silently drift.
 */
export const FILE_REQUEST_MAX_SIZE_MB = 100;
