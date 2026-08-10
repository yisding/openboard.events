import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { getStatusCountsIn, getSubmissionDetailIn, listSubmissionsIn, submissionFiltersSchema, type SubmissionFilters } from "@/features/submissions";
import { GOLDEN_AUTHORING_ROWS, GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { eventIdSchema, submissionIdSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("a1000000-0000-4000-8000-000000000002");
const formId = GOLDEN_SNAPSHOT.formId;
const trackId = trackIdSchema.parse("a1000000-0000-4000-8000-000000000010");
const tagId = tagIdSchema.parse("a1000000-0000-4000-8000-000000000011");
const speaker = "a1000000-0000-4000-8000-000000000020";
const coSpeaker = "a1000000-0000-4000-8000-000000000021";
const accepted = submissionIdSchema.parse("a1000000-0000-4000-8000-000000000030");
const pending = submissionIdSchema.parse("a1000000-0000-4000-8000-000000000031");
const draft = submissionIdSchema.parse("a1000000-0000-4000-8000-000000000032");
const elsewhere = submissionIdSchema.parse("a1000000-0000-4000-8000-000000000033");

const filters = (overrides: Partial<SubmissionFilters> = {}): SubmissionFilters =>
  submissionFiltersSchema.parse(overrides);

let pglite: PGlite;
let db: DbOrTx;

describe("abstracts queries", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    for (const [id, slug] of [[eventId, "event"], [otherEventId, "other"]] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,$2,$3,'2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, `Event ${slug}`, slug],
      );
    }
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'Platforms','#6958d7')", [trackId, eventId]);
    await pglite.query("INSERT INTO tags(id,event_id,name) VALUES($1,$2,'Evals')", [tagId, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'ada@example.com','Ada','Lovelace')", [speaker, eventId]);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'grace@example.com','Grace','Hopper')", [coSpeaker, eventId]);

    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,current_version) VALUES($1,$2,'cfp','Technical Talks','open',1)",
      [formId, eventId],
    );
    for (const section of GOLDEN_AUTHORING_ROWS.sections) {
      await pglite.query(
        "INSERT INTO form_sections(id,event_id,form_id,key,title,page_heading,description_html,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [section.id, eventId, formId, section.key, section.title, section.pageHeading, section.descriptionHtml, section.sortOrder],
      );
    }
    for (const authored of GOLDEN_AUTHORING_ROWS.fields) {
      await pglite.query(
        `INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,required,locked,max_chars,help_text,options,visibility,maps_to,sort_order)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
        [
          authored.id, eventId, formId, authored.sectionId, authored.key, authored.label, authored.fieldType,
          authored.required, authored.locked, authored.maxChars, authored.helpText,
          JSON.stringify(authored.options), authored.visibility ? JSON.stringify(authored.visibility) : null,
          authored.mapsTo, authored.sortOrder,
        ],
      );
    }
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)", [eventId, formId, JSON.stringify(GOLDEN_SNAPSHOT)]);

    await pglite.query(
      `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,title,description_html,track_id,submitter_contact_id,submitted_at)
       VALUES($1,$2,$3,1,101,'accepted','cfp','Caching at the edge','<p>Fast <b>pages</b></p>',$4,$5, now() - interval '2 days')`,
      [accepted, eventId, formId, trackId, speaker],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,title,submitter_contact_id,submitted_at)
       VALUES($1,$2,$3,1,102,'pending','cfp','Evals in production',$4, now() - interval '1 day')`,
      [pending, eventId, formId, coSpeaker],
    );
    await pglite.query(
      `INSERT INTO submissions(id,event_id,form_id,form_version,code,status,source,title,submitter_contact_id)
       VALUES($1,$2,$3,1,103,'draft','cfp','Half-written idea',$4)`,
      [draft, eventId, formId, speaker],
    );
    await pglite.query(
      "INSERT INTO submissions(id,event_id,code,status,source,title) VALUES($1,$2,201,'pending','manual','Another event entirely')",
      [elsewhere, otherEventId],
    );

    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, accepted, speaker]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,false,1)", [eventId, accepted, coSpeaker]);
    await pglite.query("INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)", [eventId, pending, coSpeaker]);
    await pglite.query("INSERT INTO submission_tags(event_id,submission_id,tag_id) VALUES($1,$2,$3)", [eventId, accepted, tagId]);

    const titleField = GOLDEN_AUTHORING_ROWS.fields.find((f) => f.key === "title");
    await pglite.query(
      "INSERT INTO submission_answers(event_id,submission_id,field_id,value) VALUES($1,$2,$3,$4::jsonb)",
      [eventId, accepted, titleField?.id, JSON.stringify({ t: "s", v: "Caching at the edge" })],
    );
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("lists this event's submissions and never another's", async () => {
    const result = await listSubmissionsIn(db, eventId, filters());
    expect(result.total).toBe(3);
    expect(result.rows.map((row) => row.code).sort()).toEqual([101, 102, 103]);
    expect(result.rows.map((row) => row.title)).not.toContain("Another event entirely");
  });

  it("carries the joined vocabulary, speakers and tags a row needs to render", async () => {
    const [row] = (await listSubmissionsIn(db, eventId, filters({ search: "caching" }))).rows;
    expect(row?.trackName).toBe("Platforms");
    expect(row?.trackColor).toBe("#6958d7");
    expect(row?.formName).toBe("Technical Talks");
    expect(row?.speakers.map((speakerRow) => speakerRow.name)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(row?.speakers[0]?.isPrimary).toBe(true);
    expect(row?.tags.map((tag) => tag.name)).toEqual(["Evals"]);
    // The list preview is text; the drawer renders the HTML.
    expect(row?.descriptionPlain).toContain("Fast");
    expect(row?.descriptionPlain).not.toContain("<b>");
  });

  it("searches by code and by speaker name, not just by title", async () => {
    expect((await listSubmissionsIn(db, eventId, filters({ search: "102" }))).rows.map((row) => row.code)).toEqual([102]);
    expect((await listSubmissionsIn(db, eventId, filters({ search: "grace" }))).total).toBe(2);
  });

  it("filters by status, track and tag", async () => {
    expect((await listSubmissionsIn(db, eventId, filters({ status: "accepted" }))).total).toBe(1);
    expect((await listSubmissionsIn(db, eventId, filters({ trackId }))).total).toBe(1);
    expect((await listSubmissionsIn(db, eventId, filters({ tagId }))).total).toBe(1);
  });

  it("counts every tab from the same filter the rows use", async () => {
    const counts = await getStatusCountsIn(db, eventId, { search: "", trackId: null, tagId: null, pageSize: 25, sort: "newest" });
    expect(counts.all).toBe(3);
    expect(counts.accepted).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.draft).toBe(1);
    expect(counts.withdrawn).toBe(0);

    // A search narrows the tabs too — otherwise the tab says 3 and the table
    // shows 1, and an organizer has to reload to find out which one lied.
    const searched = await getStatusCountsIn(db, eventId, { search: "caching", trackId: null, tagId: null, pageSize: 25, sort: "newest" });
    expect(searched.all).toBe(1);
    expect(searched.accepted).toBe(1);
  });

  it("pages without losing the total", async () => {
    const first = await listSubmissionsIn(db, eventId, filters({ pageSize: 2, page: 1 }));
    const second = await listSubmissionsIn(db, eventId, filters({ pageSize: 2, page: 2 }));
    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(1);
    expect(second.total).toBe(3);
  });

  it("applies the requested global order before taking a server page", async () => {
    const first = await listSubmissionsIn(db, eventId, filters({ sort: "code_desc", pageSize: 2, page: 1 }));
    const second = await listSubmissionsIn(db, eventId, filters({ sort: "code_desc", pageSize: 2, page: 2 }));
    expect(first.rows.map((row) => row.code)).toEqual([103, 102]);
    expect(second.rows.map((row) => row.code)).toEqual([101]);

    const titleDescending = await listSubmissionsIn(db, eventId, filters({ sort: "title_desc" }));
    expect(titleDescending.rows.map((row) => row.title)).toEqual([
      "Half-written idea",
      "Evals in production",
      "Caching at the edge",
    ]);
  });

  it("keeps one row per submission when it has ratings in two plans", async () => {
    // submission_ratings_v is per (submission, plan); a naive join shows the
    // same abstract twice and doubles the tab count. The Rating column reads the
    // *active* round — Round 1 here — because two rounds are two independent
    // verdicts and their mean is a score nobody gave.
    const reviewer = "a1000000-0000-4000-8000-000000000040";
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'reviewer@example.com','Reviewer')", [reviewer]);
    for (const [index, planId] of [
      "a1000000-0000-4000-8000-000000000050",
      "a1000000-0000-4000-8000-000000000051",
    ].entries()) {
      await pglite.query("INSERT INTO evaluation_plans(id,event_id,name,round) VALUES($1,$2,$3,$4)", [planId, eventId, `Round ${index + 1}`, index + 1]);
      await pglite.query(
        "INSERT INTO reviews(event_id,plan_id,submission_id,reviewer_user_id,overall_score,submitted_at) VALUES($1,$2,$3,$4,$5, now())",
        [eventId, planId, accepted, reviewer, 4 + index],
      );
    }

    const result = await listSubmissionsIn(db, eventId, filters({ search: "caching" }));
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.nScores).toBe(1);
    expect(result.rows[0]?.rating).toBeCloseTo(4);
  });

  it("still reports the total when the page is past the end", async () => {
    // Otherwise a table that has just been filtered shows "no results" with no
    // way to page back to them.
    const result = await listSubmissionsIn(db, eventId, filters({ page: 9, pageSize: 2 }));
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(3);
  });

  it("sorts newest first by default, with drafts last", async () => {
    const rows = (await listSubmissionsIn(db, eventId, filters())).rows;
    // A draft has no submitted_at and belongs behind everything submitted.
    expect(rows.map((row) => row.code)).toEqual([102, 101, 103]);
  });

  it("returns the drawer with its pinned snapshot and participants", async () => {
    const detail = await getSubmissionDetailIn(db, eventId, accepted);
    expect(detail.title).toBe("Caching at the edge");
    expect(detail.descriptionHtml).toContain("<b>pages</b>");
    expect(detail.participants.map((participant) => participant.email)).toEqual(["ada@example.com", "grace@example.com"]);
    expect(detail.answerPanel.formVersion).toBe(1);
    expect(detail.answerPanel.snapshot?.version).toBe(1);
    expect(detail.answerPanel.answers).toHaveLength(1);
  });

  it("refuses a submission from another event", async () => {
    const error = await getSubmissionDetailIn(db, eventId, elsewhere).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });
});
