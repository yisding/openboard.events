import type { ReactNode } from "react";

/**
 * The one way a nullable cell renders. Writing `{value}` prints "undefined" into
 * the product, and `{value ?? "-"}` produces a different dash on every surface;
 * six list modules render the same em dash because they all come through here.
 *
 * Sorting note for consumers: a column of these sorts "—" **last** in both
 * directions — see `<DataTable>`'s nullsLast comparator.
 */
export function Dash({ value, children }: { value?: unknown; children?: ReactNode }) {
  const empty = value === null || value === undefined || value === "" || (typeof value === "number" && Number.isNaN(value));
  if (empty) return <span className="dash" aria-label="not set">—</span>;
  return <>{children ?? String(value)}</>;
}
