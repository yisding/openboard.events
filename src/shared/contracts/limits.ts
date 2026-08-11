export const LIMITS = {
  THEME: 1000,
  TITLE: 255,
  BIO: 5000,
  RICHTEXT: 5000,
  PAGE_HEADING: 15,
  SECTION_HEADING: 15,
  // Hard ceiling for free-text answers whose field type carries no configurable
  // cap (phone, number, date, …). Matches the text/textarea default so no legitimate
  // answer is truncated while an unbounded string can never reach the jsonb column.
  SHORT_TEXT: 500,
} as const;

export function plainTextLength(html: string): number {
  const text = parseTag(html, () => "", (value) => value);
  return [...text].length;
}
import { parseTag } from "xss";
