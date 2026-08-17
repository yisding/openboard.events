/**
 * A person's monogram: the first letter of their first name plus the first
 * letter of their last word (their surname, or a middle name for a
 * single-word "first" input — see the two-word test below). Every avatar
 * placeholder in the product — the schedule's speaker chips, the speaker
 * gallery, the admin roster, the CRM directory — is meant to read this way,
 * so it lives here once rather than as `name.slice(0, 2)` (which reads as the
 * first two letters of the *first* name — "AI" for "Aisha Bello" — and
 * drifts from every other avatar in the product) re-derived per call site.
 */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""}`;
  return initials.toUpperCase() || "?";
}
