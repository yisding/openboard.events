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
