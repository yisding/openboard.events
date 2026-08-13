import { OPENBOARD_NS, seedId } from "./ids";

/**
 * The seeded world the specs assert on, exactly as M09 §3 specifies it. Specs
 * address artifacts by these stable names and ids — never by "the first row in
 * the table", which is the flakiest thing in a parallel-agent repo.
 *
 * M09 produces every id through `seedId(kind, key)` (uuid v5 over a fixed
 * namespace), so a spec can resolve one without querying: the ids are
 * deterministic across every wipe and every environment. The keys below are the
 * seed modules' own keys — change one here and the id stops resolving, which is
 * the intended failure mode.
 */
export const SEED_NAMESPACE = OPENBOARD_NS;

export const EVENTS = {
  /** The demo world. Everything judged renders against this event. */
  main: {
    key: "aie-nyc",
    id: seedId("event", "aie-nyc"),
    name: "AI.Engineer Sandbox — NYC",
    slug: "ai-engineer-sandbox-event",
    timezone: "America/Los_Angeles",
  },
  /** The standing empty-state test: genuinely empty, on purpose. */
  empty: {
    key: "empty-conf",
    id: seedId("event", "empty-conf"),
    name: "Empty Conf",
    slug: "empty-conf",
  },
} as const;

export const USERS = {
  organizer: "organizer@openboard.dev",
  reviewer: "reviewer@openboard.dev",
} as const;

/** `scripts/seed/forms.ts` derives every field id as `field:<formKey>-<fieldKey>`. */
function formAField(key: string): string {
  return seedId("field", `form-a-${key}`);
}

export const FORMS = {
  /** Open, limit 3, one conditional field ("Workshop duration"), one routing rule. */
  open: {
    key: "form-a",
    id: seedId("form", "form-a"),
    version: 1,
    conditionalField: "Workshop duration",
    conditionalOn: "Workshop",
    limit: 3,
    fields: {
      title: formAField("title"),
      description: formAField("description"),
      track: formAField("track"),
      format: formAField("format"),
      workshopDuration: formAField("workshop_duration"),
      topics: formAField("topics"),
      /** Classified as proposal content: an anonymized reviewer reads this one. */
      approach: formAField("approach"),
      /** Left at the fail-closed default: an anonymized reviewer must not. */
      employer: formAField("employer"),
      firstName: formAField("first_name"),
      lastName: formAField("last_name"),
      email: formAField("email"),
      company: formAField("company"),
      bio: formAField("bio"),
    },
  },
  /** Closed a day ago, so the branded closed page has something to render. */
  closed: { key: "form-b", id: seedId("form", "form-b") },
} as const;

/**
 * The two named conflict pairs and the back-to-back pair that must *not* flag.
 * `scripts/seed/agenda.ts` documents these three properties as binding.
 */
export const SESSIONS = {
  conflictA: "⚠ Demo conflict A",
  conflictB: "⚠ Demo conflict B",
  conflictA1: { id: seedId("session", "conflict-a-1"), title: "⚠ Demo conflict A — Platform deep dive" },
  conflictA2: { id: seedId("session", "conflict-a-2"), title: "⚠ Demo conflict A — Vector search at scale" },
  conflictB1: { id: seedId("session", "conflict-b-1"), title: "⚠ Demo conflict B — Agent evals live" },
  conflictB2: { id: seedId("session", "conflict-b-2"), title: "⚠ Demo conflict B — Guardrails that do not annoy anyone" },
  /** 10:00–10:30 then 10:30–11:00 in Main Stage: touching is not overlapping. */
  backToBackEarly: { id: seedId("session", "caching-edge"), title: "Caching at the edge without losing your mind" },
  backToBackLate: { id: seedId("session", "evals-survive"), title: "Evals that survive contact with users" },
  /** Published and placed on day one — the public schedule's first row. */
  publishedKeynote: { id: seedId("session", "opening-keynote"), title: "Opening keynote: the year agents grew up" },
  /** Draft and unplaced: the leakage probe for every public surface. */
  draftUnscheduled: { id: seedId("session", "unscheduled-migrating"), title: "Migrating from bespoke to boring" },
} as const;

/** `scripts/seed/events.ts`'s vocabulary, by the keys that seed uses. */
export const VOCAB = {
  rooms: {
    mainStage: seedId("room", "main-stage"),
    workshopA: seedId("room", "workshop-a"),
    studio: seedId("room", "studio"),
    atrium: seedId("room", "atrium"),
  },
  tracks: {
    agents: seedId("track", "agents"),
    platforms: seedId("track", "platforms"),
  },
  formats: {
    talk: seedId("format", "talk"),
    workshop: seedId("format", "workshop"),
  },
} as const;

/** `scripts/seed/portal.ts`'s three tasks, one per completion mode. */
export const TASKS = {
  manual: { id: seedId("task", "confirm-details"), name: "Confirm your session details" },
  fileRequest: { id: seedId("task", "upload-slides"), name: "Upload your slides" },
  form: { id: seedId("task", "update-profile"), name: "Update your profile" },
} as const;

// 7 domain templates + portal_login + M50's reviewer_invited and
// review_reminder + M51's speaker_bulk_message + M42's admin_password_reset and
// admin_email_verification (drizzle/0009) + M44's organization_invited
// (drizzle/0011). The whole `template_key` enum, in other words: `0014`
// backfills every event's missing rows precisely so this count is the enum's
// length and not "whichever keys existed when the event was created".
export const TEMPLATE_KEYS_PER_EVENT = 14;

// Password-reset, email-verification and team-invitation messages are platform
// mail: they can be sent before an event exists and are therefore fixed rather
// than event-editable. The database still carries all 14 defaults per event,
// while the Communications template rail and its API deliberately expose 11.
export const EVENT_EDITABLE_TEMPLATE_KEYS_PER_EVENT = TEMPLATE_KEYS_PER_EVENT - 3;

/**
 * Every seeded address is on a domain the project owns, and so is every address
 * a spec invents: a suite that mails a stranger is a suite that cannot be run
 * twice. Unique per call so a spec that submits can never collide with an
 * earlier run's contact.
 */
export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@openboard.events`;
}
