/**
 * The brand jade, as a **data** default.
 *
 * This is deliberately not a design token. `--accent` in `globals.css` is the
 * same colour, but it answers a different question: `--accent` is what the
 * product paints when *it* chooses, and this is what an organiser's
 * colour-valued field falls back to before they have chosen anything. Those
 * diverge the moment an organiser picks their own accent, which is the entire
 * point of the field — so a token cannot serve here, and CSS custom properties
 * are not readable from the places that need it (a zod default, a DB column
 * default, a `??` on a nullable row).
 *
 * It exists because the literal was copied to six places and they had already
 * drifted: `public_queries`' track fallback was indigo `#6366f1` while the
 * `tracks.color` column default was this jade, so an unset colour rendered
 * differently depending on whether the row predated the column default. One
 * constant is what stops that recurring.
 *
 * The DB schema defaults in `src/db/schema/*` still carry the literal on
 * purpose: drizzle emits them into generated SQL, where a TypeScript import
 * cannot follow. If this value ever changes, those change with it.
 *
 * See `plan/design/design-system.md` T6 for why a colour that is organiser
 * data is exempt from the raw-hex sweep and a colour that is a design decision
 * is not.
 */
export const DEFAULT_BRAND_COLOR = "#00a878";

/**
 * What counts as a colour an organiser may type. It lives beside the default
 * because the admin field, the wire schema and the embed renderer must all
 * agree: when they did not, a typo saved cleanly, showed a success path, and
 * was then silently discarded at render time in favour of the default.
 *
 * Both alpha forms are accepted because a hex string is the only way to enter
 * them — a native colour well only ever emits `#rrggbb`.
 */
export const ACCENT_HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Narrow an organiser-typed value to a colour, or `null` when it is not one.
 *
 * The public shell writes whatever it is handed straight into the `--accent`
 * / `--accent-dark` custom properties, and a custom property accepts any token
 * sequence — so a non-colour parses happily and then voids every downstream
 * `var(--accent)` at computed-value time, dropping the brand accent across the
 * whole public site. `events.theme` is the live example: it is a plain-text
 * conference-theme field ("Frontiers of applied AI"), not a colour picker.
 */
export function asAccentColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return ACCENT_HEX_RE.test(trimmed) ? trimmed : null;
}
