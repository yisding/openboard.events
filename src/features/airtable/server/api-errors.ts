import { AppError } from "@/shared/lib/errors";
import { AIRTABLE_COPY } from "../copy";
import { AirtableError } from "./client";

/**
 * The seam between "Airtable said no" and "the organizer reads a sentence".
 *
 * Two things go wrong without it, and both are the kind that only show up in
 * production:
 *
 * 1. **An unmapped throw becomes `INTERNAL`.** `errorEnvelope` calls
 *    `captureError` on every `INTERNAL`, which means a customer pasting a
 *    typo'd token would file an entry in `operational_error_buckets` and,
 *    eventually, page whoever is on call. A 401 from someone else's API is not
 *    an incident on our side — the same distinction `blocked` draws for sync
 *    runs, drawn here for the connect flow.
 * 2. **The raw message would reach the browser.** Airtable's error bodies
 *    quote the request. They are captured and logged (redacted) and go nowhere
 *    near a response body.
 *
 * `server` and `network` are deliberately *not* mapped. They fall through to
 * `INTERNAL`, which is the honest answer for "we asked Airtable to create a
 * base and never heard back": the outcome genuinely is unknown, and
 * `isDefinitiveWriteFailure` returning false is what routes the panel into its
 * reload-to-check branch instead of a retry that could make a second base.
 */
function translate(error: unknown): unknown {
  if (!(error instanceof AirtableError)) return error;
  switch (error.kind) {
    case "unauthorized":
      return new AppError("VALIDATION", AIRTABLE_COPY.api.unauthorized);
    case "forbidden":
      return new AppError("FORBIDDEN", AIRTABLE_COPY.api.forbidden);
    case "not_found":
      return new AppError("NOT_FOUND", AIRTABLE_COPY.api.notFound);
    case "rate_limited":
      return new AppError("RATE_LIMITED", AIRTABLE_COPY.api.rateLimited);
    case "schema":
      return new AppError("CONFLICT", AIRTABLE_COPY.api.schema);
    default:
      return error;
  }
}

/** Wraps a connect-flow call so its Airtable failures arrive as coded `AppError`s. */
export async function mapAirtableFailure<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw translate(error);
  }
}
