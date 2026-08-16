/**
 * The shape of the base we build in the customer's Airtable account.
 *
 * Runtime-neutral on purpose: the settings panel renders the same list the sync
 * engine writes, so the "make these columns by hand" instructions an organizer
 * without `schema.bases:write` copies out can never drift from what we would
 * have created ourselves.
 *
 * Two rules hold across every table here and are load-bearing rather than
 * stylistic:
 *
 * 1. **`Openboard ID` exists on every table, ungated, and is never the primary
 *    field.** It is the `fieldsToMergeOn` key of every `performUpsert`, which
 *    is what makes a push idempotent without consulting `airtable_sync_state`.
 *    Making it primary (so link fields could be filled by primary-field value)
 *    would give the organizer a base whose every linked chip reads
 *    `a3f1c8e2-…`. Links are filled with resolved record ids instead.
 * 2. **Display names are presentation; `SyncTableKey` is identity.** Nothing
 *    keyed in `airtable_sync_state.table_name` ever holds a display name, so
 *    relabelling `Proposals` to `Talks` here costs one rename in the customer's
 *    base and orphans no state row.
 */

export const SYNC_TABLE_KEYS = ["tracks", "rooms", "formats", "tags", "people", "sessions", "proposals"] as const;
export type SyncTableKey = (typeof SYNC_TABLE_KEYS)[number];

/**
 * Topological: every link target is pushed before the table that links to it,
 * so the first run resolves link ids in one pass instead of two. Correctness
 * does not depend on it — an unresolved link leaves the array short and the
 * content hash flips the moment the target lands — but a base that is complete
 * after one sync is the difference between "it works" and "it eventually
 * works".
 */
export const SYNC_TABLE_ORDER: readonly SyncTableKey[] = SYNC_TABLE_KEYS;

export const OPENBOARD_ID_FIELD = "Openboard ID";

/** Written into every table we create, and visible in Airtable's own UI. */
export const SYNCED_TABLE_DESCRIPTION = "Synced from Openboard. Edits here are overwritten on the next sync.";

export type AirtableScalarFieldType =
  | "singleLineText"
  | "multilineText"
  | "email"
  | "url"
  | "number"
  | "dateTime";

export type AirtableFieldSpec =
  | { name: string; type: AirtableScalarFieldType; options?: Record<string, unknown> }
  | { name: string; type: "multipleRecordLinks"; linkTo: SyncTableKey };

export type TablePlan = {
  key: SyncTableKey;
  displayName: string;
  /** Airtable requires the primary field first, and it may not be a link. */
  primaryField: string;
  fields: readonly AirtableFieldSpec[];
};

const NUMBER_OPTIONS = { precision: 0 } as const;
const DATE_TIME_OPTIONS = {
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
  timeZone: "utc",
} as const;

function text(name: string): AirtableFieldSpec {
  return { name, type: "singleLineText" };
}

function longText(name: string): AirtableFieldSpec {
  return { name, type: "multilineText" };
}

function count(name: string): AirtableFieldSpec {
  return { name, type: "number", options: { ...NUMBER_OPTIONS } };
}

function instant(name: string): AirtableFieldSpec {
  return { name, type: "dateTime", options: { ...DATE_TIME_OPTIONS } };
}

function link(name: string, linkTo: SyncTableKey): AirtableFieldSpec {
  return { name, type: "multipleRecordLinks", linkTo };
}

export const TABLE_PLANS: Readonly<Record<SyncTableKey, TablePlan>> = {
  tracks: {
    key: "tracks",
    displayName: "Tracks",
    primaryField: "Name",
    fields: [text("Name"), text(OPENBOARD_ID_FIELD), text("Color"), longText("Description"), count("Sort order")],
  },
  rooms: {
    key: "rooms",
    displayName: "Rooms",
    primaryField: "Name",
    fields: [text("Name"), text(OPENBOARD_ID_FIELD), count("Capacity"), count("Sort order")],
  },
  formats: {
    key: "formats",
    displayName: "Formats",
    primaryField: "Name",
    fields: [text("Name"), text(OPENBOARD_ID_FIELD), count("Default duration (mins)"), count("Sort order")],
  },
  tags: {
    key: "tags",
    displayName: "Tags",
    primaryField: "Name",
    fields: [text("Name"), text(OPENBOARD_ID_FIELD), text("Color")],
  },
  people: {
    key: "people",
    displayName: "People",
    primaryField: "Name",
    fields: [
      text("Name"), text(OPENBOARD_ID_FIELD), text("First name"), text("Last name"),
      { name: "Email", type: "email" }, text("Job title"), text("Company"), longText("Bio"),
      text("Pronouns"), text("Gender"), text("Confirmation status"),
      { name: "LinkedIn", type: "url" }, { name: "Website", type: "url" },
    ],
  },
  sessions: {
    key: "sessions",
    displayName: "Sessions",
    primaryField: "Title",
    fields: [
      text("Title"), text(OPENBOARD_ID_FIELD), text("Slug"), text("Status"),
      instant("Starts at"), instant("Ends at"), longText("Description"),
      link("Track", "tracks"), link("Room", "rooms"), link("Format", "formats"), link("Speakers", "people"),
    ],
  },
  proposals: {
    key: "proposals",
    displayName: "Proposals",
    primaryField: "Title",
    fields: [
      text("Title"), text(OPENBOARD_ID_FIELD), count("Code"), text("Status"), text("Kind"),
      text("Level"), text("Language"), longText("Description"),
      instant("Submitted at"), instant("Decided at"),
      link("Track", "tracks"), link("Format", "formats"), link("Speakers", "people"), link("Tags", "tags"),
    ],
  },
};

export function isLinkField(field: AirtableFieldSpec): field is Extract<AirtableFieldSpec, { type: "multipleRecordLinks" }> {
  return field.type === "multipleRecordLinks";
}

/** Fields a table is created with. Links need their target to exist, so they wait for pass 2. */
export function scalarFields(plan: TablePlan): AirtableFieldSpec[] {
  const scalars = plan.fields.filter((field) => !isLinkField(field));
  const primary = scalars.find((field) => field.name === plan.primaryField);
  if (!primary) throw new Error(`table plan ${plan.key} has no scalar primary field`);
  return [primary, ...scalars.filter((field) => field !== primary)];
}

export function linkFields(plan: TablePlan): Extract<AirtableFieldSpec, { type: "multipleRecordLinks" }>[] {
  return plan.fields.filter(isLinkField);
}

/**
 * Cache key for "the base already matches what we would build".
 *
 * A synchronous, dependency-free hash rather than `crypto.subtle`: this runs on
 * both sides of the wire and its only job is to invalidate a snapshot when this
 * file changes. Collision resistance is not a property anything relies on.
 */
export function tablePlansFingerprint(): string {
  const canonical = JSON.stringify(SYNC_TABLE_ORDER.map((key) => {
    const plan = TABLE_PLANS[key];
    return [plan.key, plan.displayName, plan.primaryField, plan.fields.map((field) => [
      field.name,
      field.type,
      isLinkField(field) ? field.linkTo : JSON.stringify(field.options ?? {}),
    ])];
  }));
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193) >>> 0;
    high = Math.imul(high ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `v1-${low.toString(16).padStart(8, "0")}${high.toString(16).padStart(8, "0")}`;
}

/**
 * The manual instructions an organizer without `schema.bases:write` follows,
 * generated from the same constant the engine writes against.
 */
export function manualSchemaInstructions(): { table: string; primaryField: string; fields: { name: string; type: string }[] }[] {
  return SYNC_TABLE_ORDER.map((key) => {
    const plan = TABLE_PLANS[key];
    return {
      table: plan.displayName,
      primaryField: plan.primaryField,
      fields: plan.fields.map((field) => ({
        name: field.name,
        type: isLinkField(field) ? `Link to ${TABLE_PLANS[field.linkTo].displayName}` : field.type,
      })),
    };
  });
}
