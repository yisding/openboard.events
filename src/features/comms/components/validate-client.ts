import type { TemplateKey } from "@/shared/contracts";
import { templateVariableTokens } from "./sample-vars";

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/gu;

/**
 * The client-side half of "unknown tokens are rejected client- and
 * server-side" (step 3). Deliberately not an import of
 * `server/render.ts#validateTemplateBody` — that module sits behind
 * `./templates`, which pulls the Drizzle schema graph into whatever bundle
 * imports it, and this editor is a "use client" component. The allowlist
 * itself (`templateVariableTokens`, walked off the same `TEMPLATE_VAR_SCHEMAS`
 * contract `validateTemplateBody` uses) is the shared source of truth, so the
 * two checks cannot silently drift apart; only the token-matching regex is
 * duplicated, and it is five lines.
 *
 * Note `templateVariableTokens`, not `templateVariablePaths`: the picker hides
 * `unsubscribe.url` on transactional keys, but the server still accepts it, and
 * an editor stricter than the server would report "Unknown variable" and
 * disable Save on a body saved before that filter existed.
 *
 * The client check is a UX convenience only — `saveTemplateIn` re-runs the
 * authoritative check server-side on every save, unknown-var or not.
 */
export function unknownTokensClientSide(key: TemplateKey, subject: string, body: string): string[] {
  const allowed = new Set(templateVariableTokens(key));
  const found = new Set<string>();
  for (const text of [subject, body]) {
    for (const match of text.matchAll(TOKEN)) if (match[1]) found.add(match[1]);
  }
  return [...found].filter((token) => !allowed.has(token)).sort();
}
