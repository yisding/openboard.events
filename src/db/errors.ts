/**
 * Drizzle may wrap the driver's error and retain the original as `cause`, so
 * inspect the bounded cause chain for either the structured constraint field
 * or a driver message that names it.
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
