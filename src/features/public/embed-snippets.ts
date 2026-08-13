export type EmbedSnippetOptions = {
  origin: string;
  eventSlug: string;
  route: string;
  title: string;
};

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function embedUrl({ origin, eventSlug, route }: EmbedSnippetOptions): string {
  return `${origin}/embed/${encodeURIComponent(eventSlug)}/${encodeURIComponent(route)}`;
}

/**
 * The recommended install path. The external loader creates an iframe and
 * keeps its height in sync with the live embed as content and breakpoints
 * change, avoiding the clipped content or large blank areas a fixed height
 * can produce.
 */
export function autoResizeEmbedSnippet(options: EmbedSnippetOptions): string {
  return `<script src="${escapeHtmlAttribute(options.origin)}/embed.js" data-event="${escapeHtmlAttribute(options.eventSlug)}" data-type="${escapeHtmlAttribute(options.route)}" data-title="${escapeHtmlAttribute(options.title)}" async></script>`;
}

/** A script-free fallback for CMSes that strip external script tags. */
export function fixedHeightEmbedSnippet(options: EmbedSnippetOptions): string {
  return `<iframe src="${escapeHtmlAttribute(embedUrl(options))}" width="100%" height="760" style="border:0;display:block" loading="lazy" title="${escapeHtmlAttribute(options.title)}"></iframe>`;
}
