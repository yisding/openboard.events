import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The agenda's read routes must not be reachable by a reviewer.
 *
 * `/events/[eventId]/agenda` was deliberately tightened to
 * `requireAdmin(eventId, "organizer")` — its own comment explains that the
 * reviewer bar which used to be there let a reviewer soft-navigate in from
 * `/review`, which no longer re-runs the layout. The two routes backing that
 * page kept `agendaAuth({ role: "reviewer" })`.
 *
 * That matters because `SESSION_COLUMNS` returns every session's title,
 * description and speaker ids with no status filter, drafts included. On an
 * event whose evaluation round sets `anonymize_authors`, a reviewer calling the
 * route directly could join those titles back to the anonymized abstracts in
 * their own queue and undo the round. Neither route has a reviewer client:
 * `useSessions` renders only from the organizer-gated page, and the revisions
 * query only from the organizer-only editor dialog.
 *
 * Asserted against the source because the alternative — standing up a route
 * handler with a forged reviewer session — would test Next's plumbing rather
 * than this decision, and the guard string is the decision.
 */
const ROUTES = [
  ["sessions list", "../../app/api/internal/agenda/sessions/route.ts"],
  ["session content revisions", "../../app/api/internal/agenda/sessions/[sessionId]/revisions/route.ts"],
] as const;

describe("agenda read routes", () => {
  for (const [name, path] of ROUTES) {
    it(`keeps ${name} at the organizer default, matching the page it serves`, () => {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).toContain("auth: agendaAuth()");
      expect(source).not.toContain('agendaAuth({ role: "reviewer" })');
    });
  }

  it("still matches the guard the agenda page itself applies", () => {
    const page = readFileSync(new URL("../../app/events/[eventId]/agenda/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('requireAdmin(eventId, "organizer")');
  });
});
