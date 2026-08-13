/**
 * Normalize the two raw-query result shapes used by the server: Neon returns
 * rows directly while PGlite/pg expose them on a `rows` property.
 */
export function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as { rows: unknown }).rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}
