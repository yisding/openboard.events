/**
 * Every user-facing string on the Airtable settings surface, in one frozen
 * object.
 *
 * Why a module rather than JSX literals: this integration says the same thing
 * in three places (the connect dialog before a token exists, the status card
 * after one does, and a `blocked` run three weeks later), and the moment those
 * three drift the organizer stops trusting any of them. One source also makes
 * the copy reviewable as copy — a reader can check the whole voice without
 * reading React.
 *
 * Two rules hold here:
 *
 * 1. **Nothing generic.** The catch-all apologies other products fall back on
 *    are absent by construction, and a copy regression test asserts it.
 *    Every failure sentence names what failed and what to do about it.
 *    `src/features/user-facing-copy-regressions.test.ts` is the spirit; the
 *    Airtable assertions in `copy.test.ts` are the letter.
 * 2. **No raw identifiers.** Run statuses render through `StatusBadge`,
 *    triggers through `TRIGGER_LABELS`, scopes through their capability names.
 *    An organizer never reads a run status, a trigger name, or one of
 *    Airtable's dotted scope identifiers.
 */

import type { SyncRunStats, SyncTableStats } from "./schemas";
import { SYNC_TABLE_ORDER, TABLE_PLANS, type SyncTableKey } from "./plan";

export const AIRTABLE_COPY = {
  page: {
    eyebrow: "EVENT",
    title: "Airtable",
    description: "Keep an Airtable base in step with your program.",
  },

  /** State A — nothing connected yet. */
  empty: {
    title: "Your program, live in Airtable",
    description:
      "Connect your own Airtable account and we’ll keep a base in step with your sessions, speakers, and proposals. No CSV exports, no stale copies.",
    connect: "Connect Airtable",
    resume: "Finish connecting",
    resumeNote: "Your token is saved. Pick a base and the first sync starts.",
    steps: [
      { number: "1", label: "Paste a token" },
      { number: "2", label: "Pick a base" },
      { number: "3", label: "Watch it fill" },
    ],
  },

  /**
   * The honest disclosure, shown *before* the token field.
   *
   * This is not legal boilerplate placed defensively. It is the answer to the
   * question this kind of integration generates more support mail about than
   * every other question combined: "wait, what exactly did you just copy into
   * my Airtable?"
   */
  disclosure: {
    title: "What we put in your base",
    pushedLead: "Seven tables:",
    pushedTables: "Tracks, Rooms, Formats, Tags, People, Sessions, and Proposals.",
    pushedPeople:
      "For program people that means names, email addresses, job titles, companies, bios, and headshots.",
    notPushedLead: "What never leaves Openboard:",
    notPushedBody:
      "no attendee data beyond program people, no form answers, no unsubscribe state, and no pronouns or gender unless you turn them on.",
    oneWayLead: "It only goes one way.",
    oneWayBody:
      "Nothing you type in Airtable is ever overwritten by us on an unchanged row, and equally, nothing you type there is ever read back.",
  },

  /** State B — step 1, the token. */
  token: {
    stepLabel: "Step 1 of 3",
    heading: "Paste a personal access token",
    lead: "Create one in Airtable, tick the permissions below, and paste it here. We seal it the moment Airtable confirms it.",
    fieldLabel: "Personal access token",
    placeholder: "patXXXXXXXXXXXXXX.…",
    show: "Show",
    hide: "Hide",
    createLink: "Create a token in Airtable",
    idleHint: "Keep going — Airtable tokens start with “pat” and run about 80 characters.",
    checking: "Checking with Airtable…",
    connectedTo: (account: string) => `Connected to your Airtable account (${account}).`,
    unauthorized: "Airtable didn’t recognise that token. Check you copied the whole thing, including the part after the dot.",
    revoked: "That token has been revoked or has expired in Airtable. Create a new one and paste it here.",
    rateLimited: "Airtable is asking us to slow down. Wait a few seconds and we’ll check again.",
    unreachable: "We couldn’t reach Airtable to check that token. Check your connection and try again.",
    next: "Next",
    scopesHeading: "Permissions on this token",
    // Read aloud in place of the ✓/✗, which is decorative. Phrased as a
    // statement about the token rather than as "yes"/"no", which says nothing
    // on its own once it is separated from the tick it was labelling.
    scopeGranted: "Granted:",
    scopeMissing: "Missing, and required:",
    scopeMissingOptional: "Missing, and optional:",
    scopesFooter: "Add the scope on the same token — you don’t need to make a new one.",
    recheck: "Re-check the token",
    blockedByScopes: "Add the missing permissions in Airtable, then re-check. Nothing is lost — your token stays saved.",
  },

  /** State C — step 2, where should it live. */
  base: {
    stepLabel: "Step 2 of 3",
    heading: "Where should it live?",
    lead: "Pick a base this token can already see, or let us make a fresh one.",
    useExisting: "Use an existing base",
    useExistingHint: "We’ll add the seven tables to it and leave everything else alone.",
    createNew: "Create a new base for me",
    createNewHint: "A clean base with nothing in it but your program.",
    createBlocked:
      "This token can’t create bases. Add “Create tables and fields” to it, or pick a base you already have.",
    loadingBases: "Looking for bases this token can see…",
    noBases:
      "This token can’t see any bases yet. Give it access to one in Airtable, or create a new base below.",
    baseNameLabel: "Base name",
    workspaceLabel: "Workspace id",
    workspacePlaceholder: "wsp…",
    workspaceHint:
      "Airtable has no way to list your workspaces, so we need the id. Open the workspace in Airtable and copy the part of the URL that starts with “wsp”.",
    permission: (level: string) => `You are ${level} on this base`,
    back: "Back",
    submit: "Start the first sync",
    submitting: "Setting things up…",
    listFailed: "We couldn’t list your bases. Airtable didn’t answer — try again in a moment.",
    retryList: "Try again",
  },

  /** State D — step 3, the delight beat. */
  firstRun: {
    stepLabel: "Step 3 of 3",
    heading: "Filling your base",
    progressLabel: "First sync",
    schemaPending: (baseName: string) => `Creating tables in ${baseName}…`,
    schemaDone: (tables: number) => `${tables} tables ready`,
    tablePending: (label: string) => `Sending ${label}…`,
    tableDone: (label: string, records: number) =>
      `${label} — ${records === 1 ? "1 record" : `${records} records`}`,
    doneTitle: "Done. Your base is live.",
    open: "Open in Airtable",
    finish: "Finish",
    deferred: (done: number, left: number) =>
      `That’s ${done} records so far — ${left} to go. We’ll finish them on the next sync, or hit Sync now.`,
    failed: "That first sync didn’t finish. Nothing was duplicated — hit Sync now to pick it back up.",
  },

  /** State E — connected. */
  connected: {
    heading: "Connected",
    account: (account: string) => `Connected as ${account}`,
    tokenHint: (hint: string) => `Using token pat…${hint}`,
    openBase: "Open in Airtable",
    lastSync: (relative: string) => `Last synced ${relative} ago`,
    neverSynced: "Not synced yet — hit Sync now to fill your base.",
    nextSync: (relative: string) => `Next automatic sync in about ${relative}.`,
    nextSyncDue: "Next automatic sync is due — it runs on the next quarter hour.",
    automaticPaused: "Automatic sync is paused. Sync now still works whenever you want it.",
    syncNow: "Sync now",
    syncing: "Syncing…",
    menu: "More Airtable actions",
    whatWeSync: "What we sync",
    pauseAutomatic: "Pause automatic sync",
    resumeAutomatic: "Resume automatic sync",
    disconnect: "Disconnect",
    recentHeading: "Recent syncs",
    recentEmptyTitle: "No syncs yet",
    recentEmptyBody: "The first one fills the base. After that we keep it in step every fifteen minutes.",
    columnWhen: "When",
    columnTrigger: "Trigger",
    columnResult: "Result",
    columnRecords: "Records",
    tiles: {
      sessions: "Sessions",
      people: "Speakers",
      proposals: "Proposals",
      lookups: "Lookups",
    },
    lookupsHint: "Tracks, rooms, formats, and tags",
    syncedToast: (records: number) =>
      records === 1 ? "Synced 1 record to Airtable" : `Synced ${records} records to Airtable`,
    nothingToDoToast: "Everything in Airtable already matches. Nothing to send.",
  },

  /** State F — syncing. */
  syncing: {
    progressLabel: "Sync progress",
    subtitle: (done: number, total: number) => `Syncing now — ${done} of about ${total} records.`,
    starting: "Syncing now — working out what changed.",
    slow: "This one’s taking longer than usual. It’s still running in the background — check back in a minute.",
  },

  /** State G — deferred remainder. */
  deferred: {
    title: "Picked up as far as it could",
    body: (done: number, left: number) =>
      `Synced ${done} records. ${left} left — the next run picks up exactly where this one stopped.`,
  },

  /** State H — needs attention. */
  needsAttention: {
    title: "Airtable stopped accepting your token",
    body: "Someone revoked or expired it in Airtable. Paste a new one and we’ll resume from where we stopped — nothing gets duplicated.",
    action: "Paste a new token",
  },

  /** State I — blocked / schema drifted. */
  blocked: {
    title: "Your base needs one change before the next sync",
    withScope: "We can make these for you — nothing existing is renamed, retyped, or deleted.",
    withoutScope:
      "This token can’t change your base’s structure, so these are yours to make. Every field is listed below, exactly as we’ll write to it.",
    rebuild: "Rebuild it",
    rebuilding: "Rebuilding…",
    copyFields: "Copy the field list",
    copied: "Field list copied",
    copyFailed: "Could not copy — select the list and copy it manually.",
    rebuilt: "Your base matches again. The next sync will fill it.",
    tableLine: (table: string, primary: string) => `${table} — primary field “${primary}”`,
  },

  /**
   * State I′ — the base itself is gone.
   *
   * Its own banner rather than the schema one, because every action the schema
   * banner offers is a re-ensure against a base that no longer exists: "Rebuild
   * it" re-selects the same dead id and fails the same way forever. The only
   * move that recovers is choosing a different base, so that is the only button.
   */
  baseMissing: {
    title: "That base isn’t there any more",
    body:
      "It was deleted in Airtable, or this token lost access to it. Nothing in Openboard changed — point the sync at another base and we’ll fill it from scratch.",
    action: "Pick a different base",
  },

  /** Orphans and the purge circuit breaker. */
  orphans: {
    body: (count: number) =>
      count === 1
        ? "1 record is in Airtable but no longer in Openboard."
        : `${count} records are in Airtable but no longer in Openboard.`,
    action: "Remove them",
    enabled: "Removals are on. The next sync clears anything Openboard no longer has.",
    held: (held: number, total: number, table: string) =>
      `That would delete ${held} of your ${total} ${table} rows — we’ve held off. If that’s right, confirm and we’ll do it on the next sync.`,
    confirmTitle: "Let us remove records Airtable still has?",
    confirmBody:
      "From the next sync on, a record you delete in Openboard is deleted in Airtable too. Anything you added in Airtable by hand is untouched — we only remove rows we put there.",
    confirmLabel: "Turn removals on",
  },

  /** State J — disconnect. */
  disconnect: {
    title: "Disconnect Airtable?",
    body: (baseName: string) =>
      `We’ll forget your token and stop syncing. The records already in ${baseName} stay exactly as they are — that base is yours.`,
    confirm: "Disconnect",
    cancel: "Keep it",
    done: "Airtable disconnected. Your base is untouched.",
  },

  /** State K — the "What we sync" drawer. */
  options: {
    title: "What we sync",
    lead: "These change what lands in your base. Nothing here is read back out of Airtable.",
    footer: "Changes apply on the next sync — about fifteen minutes.",
    includeEmail: {
      label: "Speaker email addresses",
      hint: "The one field a program team actually needs in the base. Off means the column is cleared on the next sync.",
    },
    includeBio: {
      label: "Speaker bios",
      hint: "Public program copy, pushed as plain text.",
    },
    includeHeadshots: {
      label: "Speaker headshots",
      hint: "Airtable keeps its own copy of each photo, so your base stays complete even if you later replace one here.",
    },
    includePronouns: {
      label: "Pronouns",
      hint: "Off by default. Turn it on only if your program publishes them.",
    },
    includeGender: {
      label: "Gender",
      hint: "Off by default. Once it is in your base, its retention is yours to manage — we can clear the column but not your snapshots.",
    },
    pruneRemoved: {
      label: "Remove records deleted in Openboard",
      hint: "Off by default. On, a session you delete here is deleted there too. We never touch rows we didn’t create.",
    },
    saved: "Saved. It takes effect on the next sync.",
  },

  /** State L — failure toasts. Specific, every one of them. */
  errors: {
    unknownOutcome: "Your Airtable connection is unconfirmed. Reload this page to see whether it saved.",
    syncUnknownOutcome: "That sync may still be running. Reload this page to see where it got to.",
    conflict: "Airtable is already running a sync for this event. Give it a few seconds.",
    statusUnavailable: "We couldn’t read the sync status. Reload the page to try again.",
    optionsFailed: "That setting didn’t save. Try it again.",
    disconnectFailed: "That disconnect didn’t go through. Try it again.",
    disconnectUnknown: "The disconnect is unconfirmed. Reload this page to see whether it went through.",
  },

  /**
   * What an Airtable-side refusal is turned into before it reaches a browser.
   *
   * Airtable's own error bodies are not shown to anyone: they name endpoints,
   * they quote request payloads, and one careless interpolation away they
   * quote a token. These five sentences are the entire vocabulary a failed
   * connect step may speak.
   */
  api: {
    unauthorized:
      "Airtable didn’t accept that token. Check you copied the whole thing — including the part after the dot — or create a new one.",
    forbidden: "This token doesn’t have the permission that step needs. Check the permissions list and add what’s missing.",
    notFound: "Airtable couldn’t find that. The base may have been deleted, or the token may have lost access to it.",
    rateLimited: "Airtable is asking us to slow down. Wait a few seconds and try again.",
    schema: "Airtable refused the shape of one of those tables. The list below says exactly what we expected.",
  },

  trigger: {
    manual: "Manual",
    cron: "Scheduled",
  },
} as const;

/** Table labels the connect dialog and the status card both read from the plan. */
export function syncTableLabel(key: SyncTableKey): string {
  return TABLE_PLANS[key].displayName;
}

/**
 * The step-3 checklist line for a table, in the voice the design asked for:
 * "Sending tracks, rooms, and formats…" rather than a table name shouted back.
 */
export const SYNC_TABLE_SENTENCE: Readonly<Record<SyncTableKey, string>> = {
  tracks: "tracks",
  rooms: "rooms",
  formats: "session formats",
  tags: "tags",
  people: "speakers",
  sessions: "sessions",
  proposals: "proposals",
};

export const SYNC_TABLE_CHECKLIST: readonly { key: SyncTableKey; label: string }[] =
  SYNC_TABLE_ORDER.map((key) => ({ key, label: SYNC_TABLE_SENTENCE[key] }));

/** Records this table actually holds in Airtable after the run touched it. */
export function tableRecordCount(table: SyncTableStats | undefined): number {
  if (!table) return 0;
  return table.created + table.updated + table.unchanged;
}

export function statsRecordCount(stats: SyncRunStats): number {
  return stats.created + stats.updated + stats.unchanged;
}

export function tableStats(stats: SyncRunStats, key: SyncTableKey): SyncTableStats | undefined {
  return stats.perTable.find((entry) => entry.key === key);
}

/** Records the four status tiles report, grouped the way an organizer thinks. */
export function tileCounts(stats: SyncRunStats): { sessions: number; people: number; proposals: number; lookups: number } {
  const lookupKeys: SyncTableKey[] = ["tracks", "rooms", "formats", "tags"];
  return {
    sessions: tableRecordCount(tableStats(stats, "sessions")),
    people: tableRecordCount(tableStats(stats, "people")),
    proposals: tableRecordCount(tableStats(stats, "proposals")),
    lookups: lookupKeys.reduce((total, key) => total + tableRecordCount(tableStats(stats, key)), 0),
  };
}

/**
 * "4 minutes", "about 2 hours", "3 days" — the phrase both "… ago" and
 * "in about …" wrap.
 *
 * Hand-rolled rather than `Intl.RelativeTimeFormat` on purpose: the repo's
 * `viewer-time` invariant routes every *absolute* instant through
 * `src/shared/lib/time.ts` so nothing renders in the viewer's zone by
 * accident, and a duration has no zone to get wrong. Exact instants on this
 * page still go through `TzTime` in the event's timezone.
 */
export function describeDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 45) return "a moment";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes <= 1 ? "a minute" : `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour" : `about ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}
