import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readProductMigrations } from "../../scripts/lib/product-migrations";

const REPAIR_TAG = "0054_form_visibility_rule_repair";

const eventId = "b0000000-0000-4000-8000-000000000001";

/**
 * Isolates the 0053 → 0054 transition: the fixtures below are the damage the
 * repair exists for, so they have to be written before it runs.
 */
describe("dangling visibility rule repair migration", () => {
  let pg: PGlite;

  beforeAll(async () => {
    const migrations = readProductMigrations();
    const repairIndex = migrations.findIndex((migration) => migration.tag === REPAIR_TAG);
    expect(repairIndex).toBeGreaterThan(0);

    pg = new PGlite();
    for (const migration of migrations.slice(0, repairIndex)) await pg.exec(migration.sql);

    await pg.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at)
       VALUES ($1,'Dangling Rules Conf','dangling-rules-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')`,
      [eventId],
    );
    await seedForm("broken", brokenSnapshot());
    await seedForm("healthy", healthySnapshot());

    for (const migration of migrations.slice(repairIndex)) await pg.exec(migration.sql);
  }, 240_000);

  afterAll(async () => pg.close());

  /**
   * `formKey` picks a deterministic uuid family so each fixture's ids read as
   * what they are in an assertion (`…f0…` form, `…a1…` fields).
   */
  function ids(formKey: string) {
    const prefix = formKey === "broken" ? "1" : "2";
    return {
      form: `b0000000-0000-4000-8000-00000000f${prefix}01`,
      section: `b0000000-0000-4000-8000-00000000e${prefix}01`,
      format: `b0000000-0000-4000-8000-00000000a${prefix}01`,
      topics: `b0000000-0000-4000-8000-00000000a${prefix}02`,
      retired: `b0000000-0000-4000-8000-00000000a${prefix}03`,
      duration: `b0000000-0000-4000-8000-00000000a${prefix}04`,
      audience: `b0000000-0000-4000-8000-00000000a${prefix}05`,
      followUp: `b0000000-0000-4000-8000-00000000a${prefix}06`,
      handout: `b0000000-0000-4000-8000-00000000a${prefix}07`,
    };
  }

  const FORMAT_OPTIONS = [{ id: "opt-talk", label: "Talk" }, { id: "opt-workshop", label: "Workshop" }];
  const TOPIC_OPTIONS = [{ id: "opt-evals", label: "Evals" }, { id: "opt-safety", label: "Safety" }];

  /**
   * Every question a fixture form carries, and the rule it was saved with.
   * `broken` is the corrupted world; `healthy` is the identical form with
   * every rule resolving, so the migration has something it must not touch.
   */
  function fields(formKey: string) {
    const id = ids(formKey);
    const broken = formKey === "broken";
    return [
      { id: id.format, key: "format", label: "Format", type: "dropdown", options: FORMAT_OPTIONS, visibility: null, deleted: false },
      { id: id.topics, key: "topics", label: "Topics", type: "multiselect", options: TOPIC_OPTIONS, visibility: null, deleted: false },
      { id: id.retired, key: "retired", label: "Retired question", type: "dropdown", options: FORMAT_OPTIONS, visibility: null, deleted: true },
      {
        // The `draft-N` trap: saved while Format's Workshop line was still a
        // placeholder, so the rule names an id the server never minted.
        id: id.duration, key: "duration", label: "Workshop length", type: "text", options: [], deleted: false,
        visibility: { match: "all", conditions: [{ sourceFieldId: id.format, op: "eq", value: broken ? "draft-2" : "opt-workshop" }] },
      },
      {
        // Two conditions, one of them dangling: the live half has to survive.
        id: id.audience, key: "audience", label: "Audience", type: "text", options: [], deleted: false,
        visibility: {
          match: "all",
          conditions: [
            { sourceFieldId: id.format, op: "eq", value: "opt-talk" },
            { sourceFieldId: id.topics, op: "in", value: broken ? ["opt-evals", "opt-gone"] : ["opt-evals", "opt-safety"] },
          ],
        },
      },
      {
        // Sourced from a question that was soft-deleted underneath it.
        id: id.followUp, key: "follow_up", label: "Follow-up", type: "text", options: [], deleted: false,
        visibility: { match: "all", conditions: [{ sourceFieldId: broken ? id.retired : id.format, op: "eq", value: "opt-talk" }] },
      },
      {
        // A free-text source: the value is prose an organizer typed, not an
        // option id, and nothing may treat it as unresolvable.
        id: id.handout, key: "handout", label: "Handout", type: "text", options: [], deleted: false,
        visibility: { match: "all", conditions: [{ sourceFieldId: id.duration, op: "eq", value: "90 minutes" }] },
      },
    ];
  }

  function snapshotFor(formKey: string) {
    const id = ids(formKey);
    return {
      formId: id.form,
      version: 1,
      context: "cfp",
      sections: [{
        id: id.section,
        key: "abstract",
        title: "Abstract",
        pageHeading: "Submission",
        descriptionHtml: "",
        fields: fields(formKey).filter((field) => !field.deleted).map((field) => ({
          id: field.id,
          key: field.key,
          label: field.label,
          type: field.type,
          required: false,
          locked: false,
          maxChars: null,
          helpText: "",
          options: field.options,
          visibility: field.visibility,
          mapsTo: null,
          reviewVisibility: "identity",
        })),
      }],
    };
  }

  const brokenSnapshot = () => snapshotFor("broken");
  const healthySnapshot = () => snapshotFor("healthy");

  async function seedForm(formKey: string, snapshot: ReturnType<typeof snapshotFor>) {
    const id = ids(formKey);
    await pg.query(
      "INSERT INTO forms(id,event_id,context,internal_name,current_version) VALUES ($1,$2,'cfp',$3,1)",
      [id.form, eventId, `${formKey} form`],
    );
    await pg.query(
      "INSERT INTO form_sections(id,event_id,form_id,key) VALUES ($1,$2,$3,'abstract')",
      [id.section, eventId, id.form],
    );
    for (const [index, field] of fields(formKey).entries()) {
      await pg.query(
        `INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,options,visibility,sort_order,deleted_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          field.id, eventId, id.form, id.section, field.key, field.label, field.type,
          JSON.stringify(field.options), field.visibility === null ? null : JSON.stringify(field.visibility),
          index, field.deleted ? new Date().toISOString() : null,
        ],
      );
    }
    await pg.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES ($1,$2,1,$3)",
      [eventId, id.form, JSON.stringify(snapshot)],
    );
  }

  async function visibilityOf(fieldId: string) {
    const rows = await pg.query<{ visibility: unknown }>(
      "SELECT visibility FROM form_fields WHERE id = $1",
      [fieldId],
    );
    return rows.rows[0]?.visibility ?? null;
  }

  it("clears a rule whose only condition names an option id nothing answers to", async () => {
    expect(await visibilityOf(ids("broken").duration)).toBeNull();
  });

  it("keeps the live half of a rule and drops only the dangling condition", async () => {
    expect(await visibilityOf(ids("broken").audience)).toEqual({
      match: "all",
      conditions: [{ sourceFieldId: ids("broken").format, op: "eq", value: "opt-talk" }],
    });
  });

  it("clears a rule sourced from a question that was deleted underneath it", async () => {
    expect(await visibilityOf(ids("broken").followUp)).toBeNull();
  });

  it("leaves a free-text condition value alone", async () => {
    expect(await visibilityOf(ids("broken").handout)).toEqual({
      match: "all",
      conditions: [{ sourceFieldId: ids("broken").duration, op: "eq", value: "90 minutes" }],
    });
  });

  it("republishes the repaired form so the public snapshot stops carrying the broken rule", async () => {
    const id = ids("broken");
    const form = await pg.query<{ current_version: number }>(
      "SELECT current_version FROM forms WHERE id = $1",
      [id.form],
    );
    expect(form.rows[0]?.current_version).toBe(2);

    const published = await pg.query<{ snapshot: { sections: { fields: { id: string; visibility: unknown }[] }[] } }>(
      "SELECT snapshot FROM form_versions WHERE form_id = $1 AND version = 2",
      [id.form],
    );
    const snapshotFields = published.rows[0]?.snapshot.sections.flatMap((section) => section.fields) ?? [];
    expect(snapshotFields.find((field) => field.id === id.duration)?.visibility).toBeNull();
    expect(snapshotFields.find((field) => field.id === id.audience)?.visibility).toEqual({
      match: "all",
      conditions: [{ sourceFieldId: id.format, op: "eq", value: "opt-talk" }],
    });
    expect(snapshotFields.find((field) => field.id === id.handout)?.visibility).toEqual({
      match: "all",
      conditions: [{ sourceFieldId: id.duration, op: "eq", value: "90 minutes" }],
    });
  });

  it("leaves the version an in-flight draft is pinned to exactly as it was published", async () => {
    const original = await pg.query<{ snapshot: unknown }>(
      "SELECT snapshot FROM form_versions WHERE form_id = $1 AND version = 1",
      [ids("broken").form],
    );
    expect(original.rows[0]?.snapshot).toEqual(brokenSnapshot());
  });

  it("does not touch a form whose rules all resolve, or mint a version for it", async () => {
    const id = ids("healthy");
    for (const field of fields("healthy")) {
      expect(await visibilityOf(field.id)).toEqual(field.visibility);
    }
    const versions = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM form_versions WHERE form_id = $1",
      [id.form],
    );
    expect(versions.rows[0]?.n).toBe(1);
  });

  it("leaves a repaired form's compare-and-swap token at the resolution its clients hold", async () => {
    const rows = await pg.query<{ remainder: number }>(
      "SELECT extract(microseconds FROM updated_at)::int % 1000 AS remainder FROM forms WHERE id = $1",
      [ids("broken").form],
    );
    expect(rows.rows[0]?.remainder).toBe(0);
  });
});
