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
