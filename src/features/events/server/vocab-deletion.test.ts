import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { eventIdSchema, type EventId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { deleteVocabItemIn } from "./vocab";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const dependencyLocks = readFileSync(new URL("../../../../drizzle/0040_vocab_dependency_locks.sql", import.meta.url), "utf8");
const roomDeletionNotice = readFileSync(new URL("../../../../drizzle/0051_room_deletion_notice.sql", import.meta.url), "utf8");

const EVENT = eventIdSchema.parse("d1000000-0000-4000-8000-000000000001");
const TRACK = "d1000000-0000-4000-8000-000000000002";
const FORMAT = "d1000000-0000-4000-8000-000000000003";
const FORM = "d1000000-0000-4000-8000-000000000004";
const SECTION = "d1000000-0000-4000-8000-000000000005";
const FIELD = "d1000000-0000-4000-8000-000000000006";
const PLAN = "d1000000-0000-4000-8000-000000000007";
const USER = "d1000000-0000-4000-8000-000000000008";
const TASK = "d1000000-0000-4000-8000-000000000009";

function option(binding: "trackId" | "formatId", id: string) {
  return [{ id: `${binding}-option`, label: "Bound", [binding]: id }];
}

function snapshot(formId: string, options: unknown[]) {
  return {
    formId,
    version: 1,
    context: "cfp",
    status: "open",
    externalTitle: "Proposals",
    pageHeading: "Welcome!",
    showWelcome: true,
    welcomeHtml: null,
    successHtml: null,
    autoRedirectToPortal: true,
    collectParticipants: true,
    participantRoles: [{ role: "speaker", enabled: true, min: 1, max: null }],
    sections: [{ id: SECTION, key: "proposal", title: "Proposal", pageHeading: "", descriptionHtml: null, sortOrder: 0,
      fields: [{ id: FIELD, key: "track", label: "Track", type: "dropdown", required: true, locked: false, maxChars: null,
        helpText: null, options, visibility: null, mapsTo: "submission.track_id", reviewVisibility: "content", sortOrder: 0 }] }],
    sendConfirmation: false,
    confirmationSubject: null,
    confirmationBodyHtml: null,
  };
}

describe("dependency-safe vocabulary deletion", () => {
  let pglite: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(dependencyLocks);
    await pglite.exec(roomDeletionNotice);
    database = drizzle(pglite, { schema });
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'reviewer@test.dev','Reviewer')", [USER]);
    await pglite.query("INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Vocab event','vocab-event','2026-09-01','2026-09-02')", [EVENT]);
  }, 60_000);

  afterAll(async () => pglite.close());

  async function reset(eventId: EventId = EVENT) {
    await pglite.query("DELETE FROM embeds WHERE event_id=$1", [eventId]);
    await pglite.query("DELETE FROM portal_tasks WHERE event_id=$1", [eventId]);
    await pglite.query("DELETE FROM forms WHERE event_id=$1", [eventId]);
    await pglite.query("DELETE FROM evaluation_plans WHERE event_id=$1", [eventId]);
    await pglite.query("DELETE FROM tracks WHERE event_id=$1", [eventId]);
    await pglite.query("DELETE FROM session_formats WHERE event_id=$1", [eventId]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color,sort_order) VALUES($1,$2,'AI','#123456',0)", [TRACK, eventId]);
    await pglite.query("INSERT INTO session_formats(id,event_id,name,default_duration_mins,sort_order) VALUES($1,$2,'Talk',30,0)", [FORMAT, eventId]);
  }

  async function insertForm(binding: "trackId" | "formatId", id: string, currentOptions = option(binding, id)) {
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,external_title,status,current_version) VALUES($1,$2,'cfp','Main CFP','Proposals','open',1)", [FORM, EVENT]);
    await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key,title) VALUES($1,$2,$3,'proposal','Proposal')", [SECTION, EVENT, FORM]);
    await pglite.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,options) VALUES($1,$2,$3,$4,'track','Track','dropdown',$5)",
      [FIELD, EVENT, FORM, SECTION, JSON.stringify(currentOptions)],
    );
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3)", [EVENT, FORM, JSON.stringify(snapshot(FORM, currentOptions))]);
  }

  async function remove(kind: "tracks" | "formats", id: string) {
    return database.transaction((tx) => deleteVocabItemIn(tx as unknown as DbOrTx, EVENT, kind, id));
  }

  it.each([
    ["tracks", "trackId", TRACK],
    ["formats", "formatId", FORMAT],
  ] as const)("blocks %s used by the current authored form and names it", async (kind, binding, id) => {
    await reset();
    await insertForm(binding, id);
    await pglite.query(
      kind === "tracks"
        ? "UPDATE forms SET opens_at='2099-01-01' WHERE id=$1"
        : "UPDATE forms SET closes_at='2020-01-01' WHERE id=$1",
      [FORM],
    );
    const filterKey = kind === "tracks" ? "trackIds" : "formatIds";
    await pglite.query("INSERT INTO embeds(event_id,name,content_type,filters) VALUES($1,'Blocked cleanup','session_list',$2)", [EVENT, JSON.stringify({ [filterKey]: [id] })]);
    const error = await remove(kind, id).catch((caught: unknown) => caught);
    expect(isAppError(error) && error.code).toBe("CONFLICT");
    expect(isAppError(error) && error.message).toContain("Main CFP");
    expect(isAppError(error) && error.details).toMatchObject({ forms: [{ id: FORM, name: "Main CFP" }] });
    expect((await pglite.query("SELECT id FROM " + (kind === "tracks" ? "tracks" : "session_formats") + " WHERE id=$1", [id])).rows).toHaveLength(1);
    expect((await pglite.query<{ filters: Record<string, string[]> }>("SELECT filters FROM embeds WHERE event_id=$1", [EVENT])).rows[0]?.filters[filterKey]).toEqual([id]);
  });

  it("blocks both evaluation-plan and reviewer track scopes and names their rounds", async () => {
    await reset();
    await pglite.query("INSERT INTO evaluation_plans(id,event_id,name,round,track_ids) VALUES($1,$2,'Round One',1,ARRAY[$3]::uuid[])", [PLAN, EVENT, TRACK]);
    let error = await remove("tracks", TRACK).catch((caught: unknown) => caught);
    expect(isAppError(error) && error.message).toContain("Round One");

    await pglite.query("UPDATE evaluation_plans SET track_ids=NULL WHERE id=$1", [PLAN]);
    await pglite.query("INSERT INTO reviewer_assignments(event_id,plan_id,user_id,track_ids) VALUES($1,$2,$3,ARRAY[$4]::uuid[])", [EVENT, PLAN, USER, TRACK]);
    error = await remove("tracks", TRACK).catch((caught: unknown) => caught);
    expect(isAppError(error) && error.message).toContain("Round One");
  });

  it("ignores historical snapshots after current authoring removes the dependency", async () => {
    await reset();
    await insertForm("trackId", TRACK);
    await pglite.query("UPDATE form_fields SET options='[]'::jsonb WHERE id=$1", [FIELD]);
    await pglite.query("INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,2,$3)", [EVENT, FORM, JSON.stringify(snapshot(FORM, []))]);
    await expect(remove("tracks", TRACK)).resolves.toBeUndefined();
    expect((await pglite.query("SELECT id FROM tracks WHERE id=$1", [TRACK])).rows).toHaveLength(0);
  });

  it("serializes a concurrent dependency commit ahead of deletion", async () => {
    await reset();
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,external_title,status,current_version) VALUES($1,$2,'cfp','Main CFP','Proposals','open',0)", [FORM, EVENT]);
    await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key,title) VALUES($1,$2,$3,'proposal','Proposal')", [SECTION, EVENT, FORM]);

    let releaseWriter!: () => void;
    const writerMayCommit = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let dependencyLocked!: () => void;
    const dependencyHasLock = new Promise<void>((resolve) => { dependencyLocked = resolve; });
    const writer = database.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,options)
        VALUES(${FIELD},${EVENT},${FORM},${SECTION},'track','Track','dropdown',${JSON.stringify(option("trackId", TRACK))}::jsonb)
      `);
      dependencyLocked();
      await writerMayCommit;
    });
    await dependencyHasLock;
    let deletionSettled = false;
    const deletion = remove("tracks", TRACK).finally(() => { deletionSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(deletionSettled).toBe(false);
    releaseWriter();
    await writer;
    await expect(deletion).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pglite.query("SELECT id FROM tracks WHERE id=$1", [TRACK])).rows).toHaveLength(1);
  });

  it("rejects a dependency writer after deletion commits first", async () => {
    await reset();
    await pglite.query("INSERT INTO forms(id,event_id,context,internal_name,external_title,status,current_version) VALUES($1,$2,'cfp','Main CFP','Proposals','open',0)", [FORM, EVENT]);
    await pglite.query("INSERT INTO form_sections(id,event_id,form_id,key,title) VALUES($1,$2,$3,'proposal','Proposal')", [SECTION, EVENT, FORM]);
    await expect(remove("tracks", TRACK)).resolves.toBeUndefined();
    await expect(pglite.query(
      "INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type,options) VALUES($1,$2,$3,$4,'track','Track','dropdown',$5)",
      [FIELD, EVENT, FORM, SECTION, JSON.stringify(option("trackId", TRACK))],
    )).rejects.toMatchObject({ code: "23503" });
  });

  it("allows an inactive closed form to release a track, then refuses to reopen with its stale binding", async () => {
    await reset();
    await insertForm("trackId", TRACK);
    await pglite.query("UPDATE forms SET status='closed' WHERE id=$1", [FORM]);
    await expect(remove("tracks", TRACK)).resolves.toBeUndefined();
    await expect(pglite.query("UPDATE forms SET status='open' WHERE id=$1", [FORM]))
      .rejects.toMatchObject({ code: "23503" });
    expect((await pglite.query<{ status: string }>("SELECT status FROM forms WHERE id=$1", [FORM])).rows[0]?.status).toBe("closed");
  });

  it("protects the highest snapshot used by an active portal task and validates reactivation", async () => {
    await reset();
    await insertForm("formatId", FORMAT);
    await pglite.query("UPDATE forms SET status='closed' WHERE id=$1", [FORM]);
    await pglite.query(
      "INSERT INTO portal_tasks(id,event_id,name,completion_mode,form_id,is_active) VALUES($1,$2,'Speaker details','form',$3,true)",
      [TASK, EVENT, FORM],
    );
    await expect(remove("formats", FORMAT)).rejects.toMatchObject({ code: "CONFLICT" });
    await pglite.query("UPDATE portal_tasks SET is_active=false WHERE id=$1", [TASK]);
    await expect(remove("formats", FORMAT)).resolves.toBeUndefined();
    await expect(pglite.query("UPDATE portal_tasks SET is_active=true WHERE id=$1", [TASK]))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("removes an unreferenced vocabulary row once, including existing cleanup", async () => {
    await reset();
    await pglite.query("INSERT INTO embeds(event_id,name,content_type,filters) VALUES($1,'Tracks','session_list',$2)", [EVENT, JSON.stringify({ trackIds: [TRACK] })]);
    await remove("tracks", TRACK);
    await expect(remove("tracks", TRACK)).resolves.toBeUndefined();
    const embed = await pglite.query<{ filters: { trackIds: string[] } }>("SELECT filters FROM embeds WHERE event_id=$1", [EVENT]);
    expect(embed.rows[0]?.filters.trackIds).toEqual([]);
  });
});
