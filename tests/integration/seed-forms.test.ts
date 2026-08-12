import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { formSnapshotSchema } from "@/shared/contracts";
import { seedEvents } from "../../scripts/seed/events";
import { seedForms } from "../../scripts/seed/forms";
import { eventLocal, SEEDED_EMPTY_EVENT_ID, SEEDED_EVENT_ID, type SeedCtx } from "../../scripts/seed/lib/helpers";
import { seedId } from "../../scripts/seed/lib/ids";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// P3-EMAIL added `events.physical_address`; the seed writes events through
// Drizzle, which names every mapped column, so the fixture needs the column
// to exist even though this suite never asserts on it.
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M42 added `users.email_verified`/`users.image`, which the seed's admin
// upsert names on every insert — same reason as the line above.
const migrationProductAuth = readFileSync(new URL("../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43 added `events.organization_id` — same reason as the line above.
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
// `seedEvents` restores the billing catalog and default subscription after a
// wipe, so this focused fixture needs M49's tables even though it does not
// assert on billing directly.
const migrationBilling = readFileSync(new URL("../../drizzle/0012_billing_scaffold.sql", import.meta.url), "utf8");
// `seedEvents` now writes a `contacts` row per admin so seeded reviewers are
// addressable by the outbox, and Drizzle names every mapped column on that
// insert: M51's `contacts.workflow_status` (0008) and M59's
// `contacts.acceptance_seen_at` (0016) have to exist here for the same reason
// the ones above do. Applied in journal order, after the rest.
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationSpeakerMoments = readFileSync(new URL("../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");

describe("forms seed", () => {
  let pglite: PGlite;
  let ctx: SeedCtx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationBilling);
    await pglite.exec(migrationSpeakerMoments);
    ctx = {
      tx: drizzle(pglite, { schema }) as unknown as TxDb,
      now: new Date("2026-08-09T12:00:00.000Z"),
      eventId: SEEDED_EVENT_ID,
      emptyEventId: SEEDED_EMPTY_EVENT_ID,
      id: seedId,
      log: () => undefined,
    };
    await seedEvents(ctx);
    await seedForms(ctx);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("maps seeded track and format choices into submission columns", async () => {
    const rows = await pglite.query<{ key: string; maps_to: string | null }>(
      "SELECT key,maps_to FROM form_fields WHERE form_id=$1 AND key IN ('track','format') ORDER BY key",
      [seedId("form", "form-a")],
    );
    expect(rows.rows).toEqual([
      { key: "format", maps_to: "submission.format_id" },
      { key: "track", maps_to: "submission.track_id" },
    ]);

    const version = await pglite.query<{ snapshot: unknown }>("SELECT snapshot FROM form_versions WHERE form_id=$1", [seedId("form", "form-a")]);
    const snapshot = formSnapshotSchema.parse(version.rows[0]?.snapshot);
    const mappings = Object.fromEntries(snapshot.sections.flatMap((section) => section.fields).map((field) => [field.key, field.mapsTo]));
    expect(mappings.track).toBe("submission.track_id");
    expect(mappings.format).toBe("submission.format_id");
  });

  it("restores every mutable seeded authoring and routing value on rerun", async () => {
    const formId = seedId("form", "form-a");
    const abstractId = seedId("section", "form-a-abstract");
    const participantId = seedId("section", "form-a-participant");
    const trackFieldId = seedId("field", "form-a-track");
    const routingId = seedId("routing_rule", "workshop-to-agents");

    await pglite.query(
      `UPDATE forms SET internal_name='stale', external_title='stale', status='closed', closes_at=now(),
       submission_limit=99, current_version=9, show_welcome=false, welcome_html='<p>stale</p>' WHERE id=$1`,
      [formId],
    );
    await pglite.query(
      "UPDATE form_sections SET key='stale-abstract', title='stale', page_heading='Stale', description_html='<p>stale</p>', sort_order=99 WHERE id=$1",
      [abstractId],
    );
    await pglite.query(
      `UPDATE form_fields SET section_id=$2, key='stale-track', label='stale', field_type='text', required=false,
       locked=true, max_chars=1, help_text='stale', options='[]'::jsonb,
       visibility='{"match":"all","conditions":[]}'::jsonb, maps_to='contact.company', sort_order=99, deleted_at=now()
       WHERE id=$1`,
      [trackFieldId, participantId],
    );
    await pglite.query(
      `UPDATE routing_rules SET sort_order=99, match='any', conditions='[]'::jsonb,
       set_track_id=$2, add_tag_ids=ARRAY[]::uuid[], enabled=false WHERE id=$1`,
      [routingId, seedId("track", "community")],
    );

    await seedForms(ctx);

    const form = await pglite.query<{
      internal_name: string; external_title: string; status: string; closes_at: Date; submission_limit: number;
      current_version: number; show_welcome: boolean; welcome_html: string;
    }>(
      `SELECT internal_name,external_title,status,closes_at,submission_limit,current_version,show_welcome,welcome_html
       FROM forms WHERE id=$1`,
      [formId],
    );
    expect(form.rows[0]).toEqual({
      internal_name: "Speak at AI.Engineer Sandbox",
      external_title: "Speak at AI.Engineer Sandbox",
      status: "open",
      closes_at: eventLocal(ctx.now, 38, "23:59"),
      submission_limit: 3,
      current_version: 1,
      show_welcome: true,
      welcome_html: "<p>We are looking for practical talks from people who have shipped something.</p>",
    });

    const section = await pglite.query<{ key: string; title: string; page_heading: string; description_html: string; sort_order: number }>(
      "SELECT key,title,page_heading,description_html,sort_order FROM form_sections WHERE id=$1",
      [abstractId],
    );
    expect(section.rows[0]).toEqual({
      key: "abstract",
      title: "Abstract Information",
      page_heading: "Submission",
      description_html: "<p>Tell us what you want to share.</p>",
      sort_order: 0,
    });

    const field = await pglite.query<{
      section_id: string; key: string; label: string; field_type: string; required: boolean; locked: boolean;
      max_chars: number | null; help_text: string; options: unknown[]; visibility: unknown; maps_to: string; sort_order: number; deleted_at: Date | null;
    }>(
      `SELECT section_id,key,label,field_type,required,locked,max_chars,help_text,options,visibility,maps_to,sort_order,deleted_at
       FROM form_fields WHERE id=$1`,
      [trackFieldId],
    );
    expect(field.rows[0]).toMatchObject({
      section_id: abstractId,
      key: "track",
      label: "Track",
      field_type: "dropdown",
      required: true,
      locked: false,
      max_chars: null,
      help_text: "",
      visibility: null,
      maps_to: "submission.track_id",
      sort_order: 2,
      deleted_at: null,
    });
    expect(field.rows[0]?.options).toHaveLength(4);

    const routing = await pglite.query<{
      sort_order: number; match: string; conditions: Array<{ sourceFieldId: string; op: string; value: string }>;
      set_track_id: string; add_tag_ids: string[]; enabled: boolean;
    }>(
      "SELECT sort_order,match,conditions,set_track_id,add_tag_ids,enabled FROM routing_rules WHERE id=$1",
      [routingId],
    );
    expect(routing.rows[0]).toEqual({
      sort_order: 0,
      match: "all",
      conditions: [{ sourceFieldId: seedId("field", "form-a-format"), op: "eq", value: "workshop" }],
      set_track_id: seedId("track", "agents"),
      add_tag_ids: [seedId("tag", "tooling")],
      enabled: true,
    });
  });

  it("reclaims a seeded field key from an organizer-created replacement", async () => {
    const formId = seedId("form", "form-a");
    const seededFieldId = seedId("field", "form-a-track");
    const replacementId = seedId("field", "organizer-replacement-track");

    await pglite.query("UPDATE form_fields SET deleted_at=now() WHERE id=$1", [seededFieldId]);
    await pglite.query(
      `INSERT INTO form_fields (id,event_id,form_id,section_id,key,label,field_type)
       VALUES ($1,$2,$3,$4,'track','Replacement track','text')`,
      [replacementId, SEEDED_EVENT_ID, formId, seedId("section", "form-a-abstract")],
    );

    await expect(seedForms(ctx)).resolves.toBeUndefined();

    const fields = await pglite.query<{ id: string; label: string; deleted_at: Date | null }>(
      "SELECT id,label,deleted_at FROM form_fields WHERE form_id=$1 AND key='track' ORDER BY id",
      [formId],
    );
    const seeded = fields.rows.find((field) => field.id === seededFieldId);
    const replacement = fields.rows.find((field) => field.id === replacementId);
    expect(seeded).toMatchObject({ label: "Track", deleted_at: null });
    expect(replacement?.deleted_at).toBeInstanceOf(Date);
  });
});
