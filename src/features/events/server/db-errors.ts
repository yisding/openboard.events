/**
 * Drizzle wraps the driver's error in one of its own and keeps the original as
 * `cause`, so the constraint name is a level or two down. Without walking the
 * chain, "that slug is taken" and "a track named X already exists" both come
 * back as an opaque 500.
 */
export function isConstraintViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const entry = current as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (entry.constraint === constraintName) return true;
    if (typeof entry.message === "string" && entry.message.includes(constraintName)) return true;
    current = entry.cause;
  }
  return false;
}
