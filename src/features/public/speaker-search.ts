import type { PublishedSpeakerDTO } from "@/shared/contracts";

export function publicSpeakerPlainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** The public speaker search promised by both the compact list and photo gallery. */
export function matchesPublicSpeakerSearch(speaker: PublishedSpeakerDTO, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = [
    speaker.name,
    speaker.company,
    speaker.jobTitle,
    speaker.bioHtml ? publicSpeakerPlainText(speaker.bioHtml) : null,
    ...speaker.sessions.flatMap((session) => [session.title, session.track?.name, session.format?.name]),
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
  return tokens.every((token) => text.includes(token));
}
