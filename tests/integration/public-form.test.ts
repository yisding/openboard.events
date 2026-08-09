import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { decideOpenState, getPublicFormIn } from "@/features/forms";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { formIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

const eventId = "b1000000-0000-4000-8000-000000000001";
const otherEventId = "b1000000-0000-4000-8000-000000000002";
const cfpForm = formIdSchema.parse(GOLDEN_SNAPSHOT.formId);
const portalForm = formIdSchema.parse("b1000000-0000-4000-8000-000000000011");
const otherEventForm = formIdSchema.parse("b1000000-0000-4000-8000-000000000012");
const logoFileId = "b1000000-0000-4000-8000-000000000020";

let pglite: PGlite;
let db: DbOrTx;

describe("getPublicForm", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at,submission_cap_per_user) VALUES($1,'AI Engineer','ai-engineer','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z',3)",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Other','other','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [otherEventId],
    );
    await pglite.query(
      "INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes) VALUES($1,$2,'logo','evt/logo','logo.png','image/png',1024)",
      [logoFileId, eventId],
    );
    await pglite.query("UPDATE events SET logo_file_id=$1 WHERE id=$2", [logoFileId, eventId]);

    await pglite.query(
      `INSERT INTO forms(id,event_id,context,internal_name,external_title,status,closes_at,submission_limit,current_version)
       VALUES($1,$2,'cfp','Technical Talks','Speak at AI Engineer','open', now() + interval '10 days', 2, 1)`,
      [cfpForm, eventId],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,target_type,current_version) VALUES($1,$2,'portal','Travel details','open','contact',1)",
      [portalForm, eventId],
    );
    await pglite.query(
      "INSERT INTO forms(id,event_id,context,internal_name,status,current_version) VALUES($1,$2,'cfp','Someone else CFP','open',1)",
      [otherEventForm, otherEventId],
    );
    for (const [formId, event] of [[cfpForm, eventId], [portalForm, eventId], [otherEventForm, otherEventId]] as const) {
      await pglite.query(
        "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)",
        [event, formId, JSON.stringify({ ...GOLDEN_SNAPSHOT, formId })],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("returns branding, copy, snapshot and openness in one read", async () => {
    const result = await getPublicFormIn(db, "ai-engineer", cfpForm);
    expect(result.event.name).toBe("AI Engineer");
    expect(result.event.timezone).toBe("America/Los_Angeles");
    // Files are immutable, so the URL is safe to cache as long as the page.
    expect(result.event.logoUrl).toBe(`/f/${logoFileId}`);
    expect(result.event.backgroundUrl).toBeNull();
    expect(result.form.externalTitle).toBe("Speak at AI Engineer");
    expect(result.snapshot.version).toBe(1);
    expect(result.openState).toEqual({ open: true, reason: "ok" });
  });

  it("prefers the form's own limit over the event cap", async () => {
    const result = await getPublicFormIn(db, "ai-engineer", cfpForm);
    expect(result.form.effectiveLimit).toBe(2);

    await pglite.query("UPDATE forms SET submission_limit=NULL WHERE id=$1", [cfpForm]);
    expect((await getPublicFormIn(db, "ai-engineer", cfpForm)).form.effectiveLimit).toBe(3);
    await pglite.query("UPDATE forms SET submission_limit=2 WHERE id=$1", [cfpForm]);
  });

  it("returns the opening timestamp needed by the not-open-yet page", async () => {
    const opensAt = "2100-09-01T12:00:00.000Z";
    await pglite.query("UPDATE forms SET opens_at=$1 WHERE id=$2", [opensAt, cfpForm]);

    const result = await getPublicFormIn(db, "ai-engineer", cfpForm);
    expect(result.form.opensAt).toBe(opensAt);
    expect(result.openState).toEqual({ open: false, reason: "not_open_yet" });

    await pglite.query("UPDATE forms SET opens_at=NULL WHERE id=$1", [cfpForm]);
  });

  it("refuses a form from another event even with the right slug", async () => {
    const error = await getPublicFormIn(db, "ai-engineer", otherEventForm).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("refuses a portal form, which is an authenticated surface", async () => {
    const error = await getPublicFormIn(db, "ai-engineer", portalForm).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
  });

  it("refuses a form that has never been published", async () => {
    await pglite.query("DELETE FROM form_versions WHERE form_id=$1", [cfpForm]);
    const error = await getPublicFormIn(db, "ai-engineer", cfpForm).catch((thrown: unknown) => thrown);
    expect(isAppError(error) && error.code).toBe("NOT_FOUND");
    await pglite.query(
      "INSERT INTO form_versions(event_id,form_id,version,snapshot) VALUES($1,$2,1,$3::jsonb)",
      [eventId, cfpForm, JSON.stringify(GOLDEN_SNAPSHOT)],
    );
  });
});

describe("decideOpenState", () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const past = new Date("2026-08-01T12:00:00.000Z");
  const future = new Date("2026-09-01T12:00:00.000Z");

  it("is open between its dates", () => {
    expect(decideOpenState({ status: "open", opensAt: past, closesAt: future }, now)).toEqual({ open: true, reason: "ok" });
  });

  it("distinguishes not-open-yet from closed, because they are different pages", () => {
    // One is a date to come back on; the other is an apology.
    expect(decideOpenState({ status: "open", opensAt: future, closesAt: null }, now).reason).toBe("not_open_yet");
    expect(decideOpenState({ status: "open", opensAt: null, closesAt: past }, now).reason).toBe("closed_by_date");
  });

  it("is closed at the exact closing instant", () => {
    expect(decideOpenState({ status: "open", opensAt: null, closesAt: now }, now))
      .toEqual({ open: false, reason: "closed_by_date" });
  });

  it("lets an admin close a form early, whatever its dates say", () => {
    // Telling a speaker to come back on a date the organizers have abandoned
    // would be a lie.
    expect(decideOpenState({ status: "closed", opensAt: past, closesAt: future }, now))
      .toEqual({ open: false, reason: "closed_by_admin" });
    expect(decideOpenState({ status: "draft", opensAt: past, closesAt: future }, now).reason).toBe("closed_by_admin");
  });
});
