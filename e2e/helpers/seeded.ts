/**
 * The seeded world the specs assert on, exactly as M09 §3 specifies it. Specs
 * address artifacts by these stable names and ids — never by "the first row in
 * the table", which is the flakiest thing in a parallel-agent repo.
 *
 * M09 produces every id through `seedId(kind, key)` (uuid v5 over a fixed
 * namespace), so a spec can resolve one without querying: the ids are
 * deterministic across every wipe and every environment.
 */
export const SEED_NAMESPACE = "4f1a5c2e-9b3d-5e7a-8c10-0d2f6b8a1e34";

export const EVENTS = {
  /** The demo world. Everything judged renders against this event. */
  main: { key: "aie-nyc", name: "AI.Engineer Sandbox — NYC", slug: "ai-engineer-sandbox-event", timezone: "America/Los_Angeles" },
  /** The standing empty-state test: genuinely empty, on purpose. */
  empty: { key: "empty-conf", name: "Empty Conf" },
} as const;

export const USERS = {
  organizer: "organizer@openboard.dev",
  reviewer: "reviewer@openboard.dev",
} as const;

export const FORMS = {
  /** Open, limit 3, one conditional field ("Workshop duration"), three routing rules. */
  open: { key: "form-a", conditionalField: "Workshop duration", conditionalOn: "Workshop", limit: 3 },
  /** Closed a day ago, so the branded closed page has something to render. */
  closed: { key: "form-b" },
} as const;

export const SESSIONS = {
  conflictA: "⚠ Demo conflict A",
  conflictB: "⚠ Demo conflict B",
} as const;

export const TEMPLATE_KEYS_PER_EVENT = 8; // 7 domain templates + portal_login
