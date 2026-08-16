/** How far down a `cause` chain either predicate below will look. */
const CAUSE_CHAIN_DEPTH = 5;

/**
 * Drizzle may wrap the driver's error and retain the original as `cause`, so
 * inspect the bounded cause chain for either the structured constraint field
 * or a driver message that names it.
 */
export function isConstraintViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < CAUSE_CHAIN_DEPTH; depth += 1) {
    const entry = current as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (entry.constraint === constraintName) return true;
    if (typeof entry.message === "string" && entry.message.includes(constraintName)) return true;
    current = entry.cause;
  }
  return false;
}

/**
 * Any unique-constraint failure, whichever index raised it — the "that name is
 * already taken" case an organizer should see as a 409 rather than a 500.
 *
 * Walks the same bounded chain as `isConstraintViolation` rather than probing a
 * fixed depth. Drizzle wraps the driver error exactly once today, so a depth-one
 * check happens to work; one extra wrapper from a drizzle or driver bump would
 * silently turn every one of these conflicts back into an unmapped 500. The
 * message fallback covers drivers that surface the failure as prose without a
 * structured `code`.
 */
export function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < CAUSE_CHAIN_DEPTH; depth += 1) {
    const entry = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (entry.code === "23505") return true;
    if (typeof entry.message === "string" && /duplicate key value|unique constraint/iu.test(entry.message)) return true;
    current = entry.cause;
  }
  return false;
}

/**
 * A foreign-key failure (`23503`) with the offending constraint's name when the
 * driver surfaces one. This is the "you pointed at a row that isn't there — or
 * isn't in this event, because the FK is composite on `(id, event_id)`" case a
 * caller should see mapped to its bad field rather than as a blind 500.
 *
 * Returns `null` when the error is anything else, and the constraint name (or
 * `""` when the driver omits it) when it is a 23503, so a caller can `if (name
 * !== null)`. Walks the same bounded cause chain as the predicates above; the
 * message fallback both detects the violation and recovers the constraint name
 * from drivers that only report it as prose.
 */
export function foreignKeyViolation(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < CAUSE_CHAIN_DEPTH; depth += 1) {
    const entry = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (entry.code === "23503") return typeof entry.constraint === "string" ? entry.constraint : "";
    if (typeof entry.message === "string" && /foreign key constraint/iu.test(entry.message)) {
      const named = entry.message.match(/foreign key constraint "([^"]+)"/iu);
      return named?.[1] ?? "";
    }
    current = entry.cause;
  }
  return null;
}
