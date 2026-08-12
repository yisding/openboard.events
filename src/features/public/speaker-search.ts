import type { PublishedSpeakerDTO } from "@/shared/contracts";
import { parseTag } from "xss";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlEntities(text: string) {
  return text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|nbsp|quot));/giu, (entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (named) return NAMED_ENTITIES[named.toLowerCase()] ?? entity;
    const codePoint = Number.parseInt(decimal ?? hex ?? "", hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

export function publicSpeakerPlainText(html: string) {
  const withoutTags = parseTag(html, () => " ", (value) => value);
  return decodeHtmlEntities(withoutTags).replace(/\s+/gu, " ").trim();
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
