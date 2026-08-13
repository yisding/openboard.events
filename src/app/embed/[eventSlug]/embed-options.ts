import type { EmbedStyle } from "@/features/public/embed-config-types";
import { DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "@/features/public/public-event-shell";

const ACCENT_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Embed appearance comes from the saved `embeds.style` row, not the iframe
 * URL. It used to come from `searchParams` (see git history / status.md
 * rev. 11's "known regression"): reading `searchParams` opts a route into
 * Next's dynamic rendering, which defeated the edge cache the CP0
 * revalidate-60 contract requires — the direct `/e/**` pages stayed
 * cacheable specifically by never touching it (see their identical
 * comment), while `/embed/**` silently lost `x-nextjs-cache: HIT`. Reading
 * style from the DB row the five embed routes already fetch for the kill
 * switch and filters closes that gap for free, and — as a side effect —
 * makes style live-update on save exactly like filters already do (the
 * `embeds-admin-page.tsx` "not baked into the iframe URL like style"
 * comment is now stale; both travel the same way).
 *
 * Admin-generated iframe/script snippets therefore use the canonical route
 * without appearance query parameters. Saved config is the only source of
 * truth for both newly installed and existing embeds.
 */
export function resolveEmbedOptions(style: EmbedStyle): EmbedOptions {
  const accent = style.accent ?? DEFAULT_EMBED_OPTIONS.accent;
  return {
    theme: style.theme === "dark" ? "dark" : "light",
    header: style.showHeader ?? DEFAULT_EMBED_OPTIONS.header,
    accent: ACCENT_RE.test(accent) ? accent : DEFAULT_EMBED_OPTIONS.accent,
  };
}
