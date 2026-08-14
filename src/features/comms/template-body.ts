import { sanitize } from "@/shared/lib/sanitize";

/**
 * Merge variables whose rendered values are URLs. They are safe to keep as an
 * entire href while editing because the server validates the variable name and
 * interpolates a schema-checked value before the message is sent.
 */
const URL_TEMPLATE_VARIABLES = new Set([
  "portal.magic_link",
  "unsubscribe.url",
  "calendar.google_url",
  "calendar.outlook_url",
  "calendar.download_url",
  "review.queue_url",
  "admin.action_url",
  "invite.action_url",
]);

const QUOTED_HREF_TOKEN = /(\bhref\s*=\s*)(["'])\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*\2/giu;
const UNQUOTED_HREF_TOKEN = /(\bhref\s*=\s*)\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/giu;

/**
 * Apply the ordinary HTML allowlist without discarding supported merge-token
 * links. Temporary HTTPS URLs let the shared sanitizer do all attribute and
 * protocol filtering; they are restored only after that boundary succeeds.
 */
export function sanitizeTemplateBody(bodyHtml: string): string {
  let placeholderVersion = 0;
  let placeholderPrefix = `https://template-merge-${placeholderVersion}.openboard.invalid/`;
  while (bodyHtml.includes(placeholderPrefix)) {
    placeholderVersion += 1;
    placeholderPrefix = `https://template-merge-${placeholderVersion}.openboard.invalid/`;
  }

  const replacements: Array<{ placeholder: string; token: string }> = [];
  function protect(prefix: string, path: string): string {
    const placeholder = `${placeholderPrefix}${replacements.length}`;
    const token = `{{${path}}}`;
    replacements.push({ placeholder, token });
    return `${prefix}"${placeholder}"`;
  }

  const protectedHtml = bodyHtml
    .replace(QUOTED_HREF_TOKEN, (match, prefix: string, _quote: string, path: string) => URL_TEMPLATE_VARIABLES.has(path) ? protect(prefix, path) : match)
    .replace(UNQUOTED_HREF_TOKEN, (match, prefix: string, path: string) => URL_TEMPLATE_VARIABLES.has(path) ? protect(prefix, path) : match);

  let cleanHtml = sanitize(protectedHtml);
  for (const { placeholder, token } of replacements) {
    cleanHtml = cleanHtml.replaceAll(placeholder, token);
  }
  return cleanHtml;
}
