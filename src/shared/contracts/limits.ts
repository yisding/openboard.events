export const LIMITS = {
  THEME: 1000,
  TITLE: 255,
  BIO: 5000,
  RICHTEXT: 5000,
  PAGE_HEADING: 15,
  SECTION_HEADING: 15,
} as const;

export function plainTextLength(html: string): number {
  return [...html.replace(/<[^>]*>/g, "")].length;
}
