export const LIMITS = {
  THEME: 1000,
  TITLE: 255,
  BIO: 5000,
  RICHTEXT: 5000,
  PAGE_HEADING: 15,
  SECTION_HEADING: 15,
} as const;

export function plainTextLength(html: string): number {
  const text = parseTag(html, () => "", (value) => value);
  return [...text].length;
}
import { parseTag } from "xss";
