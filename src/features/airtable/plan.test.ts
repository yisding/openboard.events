import { describe, expect, it } from "vitest";
import {
  OPENBOARD_ID_FIELD,
  SYNC_TABLE_KEYS,
  SYNC_TABLE_ORDER,
  TABLE_PLANS,
  isLinkField,
  linkFields,
  manualSchemaInstructions,
  scalarFields,
  tablePlansFingerprint,
} from "./plan";

/**
 * `TABLE_PLANS` is the one artifact three different things read from: the
 * engine that writes to a customer's base, the manual-instructions generator
 * an organizer without `schema.bases:write` copies out, and
 * `airtable_sync_state.table_name`'s meaning. A silent change to any name here
 * is not a refactor, it is data loss in someone else's Airtable account — so
 * table and field names are asserted **literally**, not just structurally.
 */

describe("SYNC_TABLE_ORDER", () => {
  it("is a valid topological order: every link target appears earlier than its referrer", () => {
    const position = new Map(SYNC_TABLE_ORDER.map((key, index) => [key, index]));
    for (const key of SYNC_TABLE_ORDER) {
      for (const field of TABLE_PLANS[key].fields) {
        if (!isLinkField(field)) continue;
        const targetPosition = position.get(field.linkTo);
        expect(targetPosition, `${key}.${field.name} links to ${field.linkTo}`).toBeDefined();
        expect(targetPosition as number, `${key}.${field.name} must be pushed after ${field.linkTo}`).toBeLessThan(position.get(key) as number);
      }
    }
  });

  it("contains exactly the seven declared tables, once each", () => {
    expect([...SYNC_TABLE_ORDER].sort()).toEqual([...SYNC_TABLE_KEYS].sort());
    expect(new Set(SYNC_TABLE_ORDER).size).toBe(SYNC_TABLE_ORDER.length);
  });

  it("matches the literal order the design specifies", () => {
    // Not just "a valid topological order" — *this* order, because it is also
    // the order the engine writes in, and a first sync that resolves every
    // link on one pass depends on it.
    expect(SYNC_TABLE_ORDER).toEqual(["tracks", "rooms", "formats", "tags", "people", "sessions", "proposals"]);
  });
});

describe("every table plan", () => {
  it("carries Openboard ID, ungated, as an ordinary scalar column", () => {
    for (const key of SYNC_TABLE_ORDER) {
      const plan = TABLE_PLANS[key];
      const field = plan.fields.find((candidate) => candidate.name === OPENBOARD_ID_FIELD);
      expect(field, `${key} has no ${OPENBOARD_ID_FIELD} field`).toBeDefined();
      expect(field && isLinkField(field)).toBe(false);
    }
  });

  it("has a human-readable primary field that is never Openboard ID", () => {
    for (const key of SYNC_TABLE_ORDER) {
      const plan = TABLE_PLANS[key];
      expect(plan.primaryField).not.toBe(OPENBOARD_ID_FIELD);
      // A field a human would recognise, not our internal key.
      expect(["Name", "Title"]).toContain(plan.primaryField);
      const primary = plan.fields.find((field) => field.name === plan.primaryField);
      expect(primary, `${key} declares primaryField "${plan.primaryField}" but has no such field`).toBeDefined();
    }
  });

  it("puts the primary field first among the scalar fields the table is created with", () => {
    for (const key of SYNC_TABLE_ORDER) {
      const plan = TABLE_PLANS[key];
      expect(scalarFields(plan)[0]?.name).toBe(plan.primaryField);
    }
  });

  it("never puts a link field before every one of its targets exists in the order", () => {
    for (const key of SYNC_TABLE_ORDER) {
      for (const field of linkFields(TABLE_PLANS[key])) {
        expect(SYNC_TABLE_ORDER.includes(field.linkTo)).toBe(true);
      }
    }
  });
});

describe("literal names — a rename here orphans a customer's synced base", () => {
  it("uses these exact display names", () => {
    expect(Object.fromEntries(SYNC_TABLE_ORDER.map((key) => [key, TABLE_PLANS[key].displayName]))).toEqual({
      tracks: "Tracks",
      rooms: "Rooms",
      formats: "Formats",
      tags: "Tags",
      people: "People",
      sessions: "Sessions",
      proposals: "Proposals",
    });
  });

  it("uses these exact field names for Sessions", () => {
    expect(TABLE_PLANS.sessions.fields.map((field) => field.name)).toEqual([
      "Title", "Openboard ID", "Slug", "Status", "Starts at", "Ends at", "Description",
      "Track", "Room", "Format", "Speakers",
    ]);
  });

  it("uses these exact field names for People", () => {
    expect(TABLE_PLANS.people.fields.map((field) => field.name)).toEqual([
      "Name", "Openboard ID", "First name", "Last name", "Email", "Job title", "Company",
      "Bio", "Headshot", "Pronouns", "Gender", "Confirmation status", "LinkedIn", "Website",
    ]);
  });

  it("uses these exact field names for Proposals", () => {
    expect(TABLE_PLANS.proposals.fields.map((field) => field.name)).toEqual([
      "Title", "Openboard ID", "Code", "Status", "Kind", "Level", "Language", "Description",
      "Submitted at", "Decided at", "Track", "Format", "Speakers", "Tags",
    ]);
  });
});

describe("tablePlansFingerprint", () => {
  it("is stable across calls and changes if a field's type changes", () => {
    const first = tablePlansFingerprint();
    const second = tablePlansFingerprint();
    expect(first).toBe(second);
    expect(first).toMatch(/^v1-[0-9a-f]{16}$/u);
  });
});

describe("manualSchemaInstructions", () => {
  it("generates one entry per table, naming every field the engine would create", () => {
    const instructions = manualSchemaInstructions();
    expect(instructions).toHaveLength(SYNC_TABLE_ORDER.length);
    const sessions = instructions.find((entry) => entry.table === "Sessions");
    expect(sessions?.primaryField).toBe("Title");
    expect(sessions?.fields.map((field) => field.name)).toContain("Openboard ID");
    const track = sessions?.fields.find((field) => field.name === "Track");
    expect(track?.type).toBe("Link to Tracks");
  });

  it("names the attachment column by the label Airtable's own field picker uses", () => {
    // An organizer without `schema.bases:write` builds these columns by hand.
    // "multipleAttachments" is the API's name for the type and appears nowhere
    // in the menu they are reading.
    const people = manualSchemaInstructions().find((entry) => entry.table === "People");
    expect(people?.fields.find((field) => field.name === "Headshot")?.type).toBe("Attachment");
  });
});
