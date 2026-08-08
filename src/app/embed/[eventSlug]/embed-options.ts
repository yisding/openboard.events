import { DEFAULT_EMBED_OPTIONS, type EmbedOptions } from "@/features/public/public-event-shell";

// Embed appearance travels on the iframe URL so the settings the organizer
// configured apply for every visitor, not only the configuring browser.
export function parseEmbedOptions(searchParams: Record<string, string | string[] | undefined>): EmbedOptions {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const accent = first(searchParams.accent) ?? DEFAULT_EMBED_OPTIONS.accent;
  return {
    theme: first(searchParams.theme) === "dark" ? "dark" : "light",
    header: first(searchParams.header) !== "0",
    accent: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(accent) ? accent : DEFAULT_EMBED_OPTIONS.accent,
  };
}
