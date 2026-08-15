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
  // A reviewer's written answer to a criterion and their private note share one
  // ceiling, so the count that greys out the textarea and the count that rejects
  // the save are the same number.
  REVIEW_TEXT: 2000,
  // A contact's job title and company. Every writer of those columns — the
  // speaker roster, the CRM and the speaker's own portal profile — shares this
  // ceiling: a value one writer accepts must never be one another rejects, or
  // the profile form (which sends both fields on every save) would be stuck.
  JOB_TITLE: 160,
} as const;

export function plainTextLength(html: string): number {
  const text = parseTag(html, () => "", (value) => value);
  return [...text].length;
}
import { parseTag } from "xss";
