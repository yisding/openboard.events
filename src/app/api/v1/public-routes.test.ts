import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { applyProductMigrations } from "../../../../scripts/lib/product-migrations";

/**
 * The three unauthenticated `/api/v1` public DTO routes, driven as deployed
 * handlers against a real Postgres.
 *
 * These endpoints are the app's widest blast radius: anyone may call them from
 * any origin, so the assertions that matter are the negative ones — a draft
 * session, an unconfirmed speaker, an email address or a confirmation state
 * appearing here cannot be walked back. The DTOs are written out column by
 * column rather than spread from the row, and this test is what keeps that
 * true when the underlying view gains a column.
 *
 * Migrations run through the full journal (`applyProductMigrations`) rather
 * than a hand-picked subset: this test used to cherry-pick four migration
 * files by name, which is exactly the kind of list a later migration (First
 * Fair's `0044`, adding `events.is_demo`) breaks silently the moment any
 * route it exercises starts selecting the new column.
 */

const EVENT_ID = "b0000000-0000-4000-8000-000000000001";
const SLUG = "public-dto-event";
const SPEAKER_CONFIRMED = "b0000000-0000-4000-8000-000000000010";
const SPEAKER_UNCONFIRMED = "b0000000-0000-4000-8000-000000000011";
const SESSION_PUBLISHED = "b0000000-0000-4000-8000-000000000020";
const SESSION_DRAFT = "b0000000-0000-4000-8000-000000000021";
const ROOM_ID = "b0000000-0000-4000-8000-000000000030";
const TRACK_ID = "b0000000-0000-4000-8000-000000000031";
const FORMAT_ID = "b0000000-0000-4000-8000-000000000032";

const pglite = new PGlite();
const testDb = drizzle(pglite, { schema });

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    db: new Proxy({}, { get: (_target, property) => Reflect.get(testDb, property, testDb) }),
  };
});

const { GET: getEvent } = await import("./events/[slug]/route");
const { GET: getSchedule } = await import("./events/[slug]/schedule/route");
const { GET: getSpeakers } = await import("./events/[slug]/speakers/route");

function context(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

function request(path: string) {
  return new Request(`https://example.test/api/v1${path}`);
}

describe("api/v1 public DTO routes", () => {
  beforeAll(async () => {
    await applyProductMigrations(pglite);

    await pglite.query(
      `INSERT INTO events(id,name,slug,timezone,starts_at,ends_at,website_url,location)
       VALUES($1,'Public DTO Event',$2,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','https://example.test','Moscone')`,
      [EVENT_ID, SLUG],
    );
    await pglite.query("INSERT INTO rooms(id,event_id,name) VALUES($1,$2,'Main Hall')", [ROOM_ID, EVENT_ID]);
    await pglite.query("INSERT INTO tracks(id,event_id,name,color) VALUES($1,$2,'AI Agents','#00a878')", [TRACK_ID, EVENT_ID]);
    await pglite.query("INSERT INTO session_formats(id,event_id,name) VALUES($1,$2,'Talk')", [FORMAT_ID, EVENT_ID]);

    await pglite.query(
      `INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status,job_title,company,bio_html,linkedin_url,website_url)
       VALUES($1,$2,'confirmed@example.com','Ada','Lovelace','confirmed','Engineer','Analytical','<p>bio</p>','https://linkedin.test/ada','https://ada.test')`,
      [SPEAKER_CONFIRMED, EVENT_ID],
    );
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name,confirmation_status) VALUES($1,$2,'unconfirmed@example.com','Grace','Hopper','unconfirmed')",
      [SPEAKER_UNCONFIRMED, EVENT_ID],
    );

    await pglite.query(
      `INSERT INTO sessions(id,event_id,title,slug,description_html,starts_at,ends_at,status,room_id,track_id,format_id)
       VALUES($1,$2,'Published Talk','published-talk','<p>published</p>','2026-09-16T05:30:00Z','2026-09-16T06:00:00Z','published',$3,$4,$5)`,
      [SESSION_PUBLISHED, EVENT_ID, ROOM_ID, TRACK_ID, FORMAT_ID],
    );
    await pglite.query(
      `INSERT INTO sessions(id,event_id,title,slug,starts_at,ends_at,status)
       VALUES($1,$2,'Draft Talk','draft-talk','2026-09-15T17:00:00Z','2026-09-15T17:30:00Z','draft')`,
      [SESSION_DRAFT, EVENT_ID],
    );

    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,0)", [EVENT_ID, SESSION_PUBLISHED, SPEAKER_CONFIRMED]);
    await pglite.query("INSERT INTO session_speakers(event_id,session_id,contact_id,sort_order) VALUES($1,$2,$3,1)", [EVENT_ID, SESSION_PUBLISHED, SPEAKER_UNCONFIRMED]);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("answers one explicit event DTO from the database", async () => {
    const response = await getEvent(request(`/events/${SLUG}`), context(SLUG));
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Record<string, unknown> };
    expect(Object.keys(payload.data).sort()).toEqual([
      "endsAt", "id", "isDemo", "location", "name", "slug", "startsAt", "timezone", "websiteUrl",
    ]);
    expect(payload.data.slug).toBe(SLUG);
    expect(payload.data.websiteUrl).toBe("https://example.test");
    // First Fair (design §5.1) — additive on the resource, false for every
    // event this test ever inserts.
    expect(payload.data.isDemo).toBe(false);
  });

  it("404s an unknown slug instead of synthesizing an event", async () => {
    const response = await getEvent(request("/events/no-such-event"), context("no-such-event"));
    expect(response.status).toBe(404);
    const payload = await response.json() as { error?: { code: string }; data?: unknown };
    expect(payload.error?.code).toBe("NOT_FOUND");
    expect(payload.data).toBeUndefined();
  });

  it("keeps the schedule DTO explicit and excludes drafts and unconfirmed speakers", async () => {
    const response = await getSchedule(request(`/events/${SLUG}/schedule`), context(SLUG));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: Array<Record<string, unknown> & { id: string; speakers: Array<{ id: string }> }>;
      meta: { count: number; event: { slug: string; name: string; timezone: string } };
    };
    expect(payload.data.map((session) => session.id)).toEqual([SESSION_PUBLISHED]);
    expect(Object.keys(payload.data[0] ?? {}).sort()).toEqual([
      "descriptionHtml", "endsAt", "format", "id", "room", "speakers", "startsAt", "title", "track", "trackColor",
    ]);
    const speakerIds = payload.data.flatMap((session) => session.speakers).map((speaker) => speaker.id);
    expect(speakerIds).toEqual([SPEAKER_CONFIRMED]);
    expect(payload.meta.event).toMatchObject({ slug: SLUG, timezone: "America/Los_Angeles" });
  });

  it("keeps the speaker DTO free of email and confirmation state", async () => {
    const response = await getSpeakers(request(`/events/${SLUG}/speakers`), context(SLUG));
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: Array<Record<string, unknown> & { id: string }>;
      meta: { count: number };
    };
    expect(payload.data.map((speaker) => speaker.id)).toEqual([SPEAKER_CONFIRMED]);
    expect(Object.keys(payload.data[0] ?? {}).sort()).toEqual([
      "bioHtml", "company", "firstName", "headshotUrl", "id", "lastName", "linkedin", "title", "twitter", "website",
    ]);
    expect(JSON.stringify(payload.data)).not.toContain("@example.com");
    expect(payload.meta.count).toBe(1);
  });

  it("serves the public DTOs with a shared-cacheable, cross-origin header set", async () => {
    const response = await getSchedule(request(`/events/${SLUG}/schedule`), context(SLUG));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");
  });
});
