import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { authorizeAdmin } from "@/features/auth";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import {
  createResourcePageIn,
  deleteResourcePageIn,
  excerptFromHtml,
  reorderResourcePagesIn,
  saveResourcePageIn,
  saveResourcePageInputSchema,
} from "./mutations";
import { getResourcePageByIdIn, getResourcePageIn, listResourcePagesIn } from "./queries";

const migration0 = readFileSync(new URL("../../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("d6000000-0000-4000-8000-000000000001");
const otherEventId = eventIdSchema.parse("d6000000-0000-4000-8000-000000000002");
const organizerId = userIdSchema.parse("d6000000-0000-4000-8000-000000000003");
const reviewerId = userIdSchema.parse("d6000000-0000-4000-8000-000000000004");

let pglite: PGlite;
let db: DbOrTx;

const pageInput = (overrides: Record<string, unknown> = {}) =>
  saveResourcePageInputSchema.parse({ title: "Speaker Guide", bodyHtml: "<p>Hi</p>", published: true, ...overrides });

describe("resource pages: database CRUD, the wide-sanitize-on-save law, and event isolation", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,timezone) VALUES($1,'Resources Event','resources-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','America/Los_Angeles')",
      [eventId],
    );
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,timezone) VALUES($1,'Other Event','other-event','2026-10-01T16:00:00Z','2026-10-02T01:00:00Z','America/Los_Angeles')",
      [otherEventId],
    );
    await pglite.query(
      "INSERT INTO users(id,email,name) VALUES($1,'resource-organizer@example.test','Resource Organizer'),($2,'resource-reviewer@example.test','Resource Reviewer')",
      [organizerId, reviewerId],
    );
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$3,'organizer'),($2,$3,'reviewer')",
      [organizerId, reviewerId, eventId],
    );
  }, 60_000);

  it("creates a page, deriving the slug from the title, assigning the next sort_order, and computing a plaintext summary", async () => {
    const { pageId } = await saveResourcePageIn(db, eventId, pageInput({
      title: "First Page",
      bodyHtml: "<h2>Welcome</h2><p>Check in at the Speaker Lounge.</p><script>alert(1)</script>",
    }));
    const page = await getResourcePageByIdIn(db, eventId, pageId);
    expect(page?.slug).toBe("first-page");
    expect(page?.sortOrder).toBe(0);
    expect(page?.published).toBe(true);
    // The excerpt is computed off the sanitized body, so a stripped script's
    // text content never leaks into it either — and the heading is left to the
    // body rather than fused into the sentence beneath it.
    expect(page?.summary).toBe("Check in at the Speaker Lounge.");
  });

  it("replays a collection create by stable client id without duplicating or rewriting it", async () => {
    const stableId = "d6000000-0000-4000-8000-000000000090";
    const input = pageInput({ id: stableId, title: "Retry-safe resource", slug: "retry-safe-resource" });

    await expect(createResourcePageIn(db, eventId, input)).resolves.toEqual({ pageId: stableId });
    await expect(createResourcePageIn(db, eventId, { ...input, title: "Changed retry body" })).resolves.toEqual({ pageId: stableId });

    const rows = await pglite.query<{ n: number; title: string }>(
      "SELECT count(*)::int AS n, min(title) AS title FROM resource_pages WHERE id=$1",
      [stableId],
    );
    expect(rows.rows[0]).toMatchObject({ n: 1, title: "Retry-safe resource" });
  });

  it("slug uniqueness is scoped per event: the same slug is rejected within an event but allowed in another", async () => {
    await saveResourcePageIn(db, eventId, pageInput({ title: "Venue & Travel", slug: "venue-travel" }));

    const dup = await saveResourcePageIn(db, eventId, pageInput({ title: "Venue and Travel (again)", slug: "venue-travel" }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(dup) && dup.code).toBe("VALIDATION");
    expect(isAppError(dup) && dup.message).toBe("That URL is already used");
    expect(isAppError(dup) && dup.fieldErrors?.slug).toBe("That URL is already used");

    const editable = await saveResourcePageIn(db, eventId, pageInput({ title: "Editable", slug: "editable" }));
    const updateDup = await saveResourcePageIn(db, eventId, pageInput({ id: editable.pageId, title: "Editable", slug: "venue-travel" }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(updateDup) && updateDup.code).toBe("VALIDATION");
    expect(isAppError(updateDup) && updateDup.fieldErrors?.slug).toBe("That URL is already used");

    // A different event can use the identical slug — the unique constraint is
    // (event_id, slug), never slug alone.
    await expect(saveResourcePageIn(db, otherEventId, pageInput({ title: "Venue & Travel", slug: "venue-travel" })))
      .resolves.toMatchObject({ pageId: expect.any(String) as string });
  });

  it("a reserved word is rejected as a slug", async () => {
    const rejected = await saveResourcePageIn(db, eventId, pageInput({ title: "Admin", slug: "admin" }))
      .catch((thrown: unknown) => thrown);
    expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");
    expect(isAppError(rejected) && rejected.fieldErrors?.slug).toBe("That word is reserved");
  });

  it("sanitizes on save through the wide profile: an allowlisted iframe survives, a script and an onerror handler do not", async () => {
    const dirty = '<h2>Venue</h2><iframe src="https://www.youtube.com/embed/abc123" allowfullscreen></iframe>'
      + "<script>alert(1)</script>"
      + '<img src="x" onerror="alert(1)">'
      + '<iframe src="https://evil.example/embed"></iframe>';
    const { pageId } = await saveResourcePageIn(db, eventId, pageInput({ title: "Sanitize Probe", bodyHtml: dirty }));
    const stored = await pglite.query<{ body_html: string }>("SELECT body_html FROM resource_pages WHERE id = $1", [pageId]);
    const bodyHtml = stored.rows[0]?.body_html ?? "";
    expect(bodyHtml).toContain("www.youtube.com");
    expect(bodyHtml).not.toContain("<script");
    expect(bodyHtml).not.toContain("onerror");
    expect(bodyHtml).not.toContain("evil.example");
  });

  it("publishedOnly hides drafts from the list and from a direct slug lookup, without distinguishing a draft from a slug that never existed", async () => {
    await saveResourcePageIn(db, eventId, pageInput({ title: "Published One", slug: "published-one", published: true }));
    await saveResourcePageIn(db, eventId, pageInput({ title: "Internal Notes", slug: "internal-notes-test", published: false }));

    const publishedOnly = await listResourcePagesIn(db, eventId, { publishedOnly: true });
    expect(publishedOnly.some((page) => page.slug === "internal-notes-test")).toBe(false);
    expect(publishedOnly.some((page) => page.slug === "published-one")).toBe(true);

    const everything = await listResourcePagesIn(db, eventId, { publishedOnly: false });
    expect(everything.some((page) => page.slug === "internal-notes-test")).toBe(true);

    const draftLookup = await getResourcePageIn(db, eventId, "internal-notes-test", { publishedOnly: true });
    const missingLookup = await getResourcePageIn(db, eventId, "does-not-exist", { publishedOnly: true });
    expect(draftLookup).toBeNull();
    expect(missingLookup).toBeNull();
  });

  it("cross-event isolation: a page in one event is invisible from another, even by exact slug", async () => {
    await saveResourcePageIn(db, otherEventId, pageInput({ title: "Only In Other Event", slug: "only-in-other-event" }));
    const fromWrongEvent = await getResourcePageIn(db, eventId, "only-in-other-event");
    expect(fromWrongEvent).toBeNull();
    const list = await listResourcePagesIn(db, eventId);
    expect(list.some((page) => page.slug === "only-in-other-event")).toBe(false);
  });

  it("R11: a stale expectedUpdatedAt produces a friendly 409, never a silent overwrite", async () => {
    const { pageId } = await saveResourcePageIn(db, eventId, pageInput({ title: "Stale Write Target", slug: "stale-write-target" }));
    const loaded = await getResourcePageByIdIn(db, eventId, pageId);
    expect(loaded).not.toBeNull();

    // Somebody else's save lands first.
    await saveResourcePageIn(db, eventId, pageInput({ id: pageId, title: "Changed By Someone Else", slug: "stale-write-target" }));

    const stale = await saveResourcePageIn(
      db,
      eventId,
      pageInput({ id: pageId, title: "My Overwrite", slug: "stale-write-target" }),
      loaded?.updatedAt,
    ).catch((thrown: unknown) => thrown);
    expect(isAppError(stale) && stale.code).toBe("STALE_WRITE");

    const untouched = await getResourcePageByIdIn(db, eventId, pageId);
    expect(untouched?.title).toBe("Changed By Someone Else");
  });

  it("a save without expectedUpdatedAt never raises STALE_WRITE, even against a row that has since changed", async () => {
    const { pageId } = await saveResourcePageIn(db, eventId, pageInput({ title: "No Guard", slug: "no-guard" }));
    await saveResourcePageIn(db, eventId, pageInput({ id: pageId, title: "No Guard, Changed", slug: "no-guard" }));
    const saved = await saveResourcePageIn(db, eventId, pageInput({ id: pageId, title: "No Guard, Changed Again", slug: "no-guard" }));
    expect(saved.pageId).toBe(pageId);
  });

  it("reorder renumbers the whole list and rejects a set that does not match the event's current pages exactly", async () => {
    const freshEventId = eventIdSchema.parse("d6000000-0000-4000-8000-000000000009");
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at,timezone) VALUES($1,'Reorder Event','reorder-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z','America/Los_Angeles')",
      [freshEventId],
    );
    const a = await saveResourcePageIn(db, freshEventId, pageInput({ title: "A", slug: "a" }));
    const b = await saveResourcePageIn(db, freshEventId, pageInput({ title: "B", slug: "b" }));
    const c = await saveResourcePageIn(db, freshEventId, pageInput({ title: "C", slug: "c" }));

    await reorderResourcePagesIn(db, freshEventId, [c.pageId, a.pageId, b.pageId]);
    const ordered = await listResourcePagesIn(db, freshEventId);
    expect(ordered.map((page) => page.slug)).toEqual(["c", "a", "b"]);

    const rejected = await reorderResourcePagesIn(db, freshEventId, [a.pageId, b.pageId]).catch((thrown: unknown) => thrown);
    expect(isAppError(rejected) && rejected.code).toBe("VALIDATION");
  });

  it("makes authorized event-scoped absence canonical while preserving cross-event rows and organizer authorization", async () => {
    const { pageId } = await saveResourcePageIn(db, eventId, pageInput({ title: "Deletable", slug: "deletable" }));
    await authorizeAdmin(db, {
      userId: organizerId,
      email: "resource-organizer@example.test",
      name: "Resource Organizer",
    }, eventId, "organizer");
    await deleteResourcePageIn(db, eventId, pageId);
    expect(await getResourcePageByIdIn(db, eventId, pageId)).toBeNull();

    // A response-loss replay reaches the same canonical absent state.
    await expect(deleteResourcePageIn(db, eventId, pageId)).resolves.toBeUndefined();

    const { pageId: otherPageId } = await saveResourcePageIn(db, otherEventId, pageInput({ title: "Belongs To Other", slug: "belongs-to-other" }));
    await expect(deleteResourcePageIn(db, eventId, otherPageId)).resolves.toBeUndefined();
    expect(await getResourcePageByIdIn(db, otherEventId, otherPageId)).not.toBeNull();

    // The actual route's organizer guard uses this same authorization query;
    // a reviewer is refused before the event-scoped DELETE can run.
    const protectedPage = await saveResourcePageIn(db, eventId, pageInput({ title: "Organizer Only", slug: "organizer-only" }));
    const deleteAsReviewer = async () => {
      await authorizeAdmin(db, {
        userId: reviewerId,
        email: "resource-reviewer@example.test",
        name: "Resource Reviewer",
      }, eventId, "organizer");
      await deleteResourcePageIn(db, eventId, protectedPage.pageId);
    };
    const forbidden = await deleteAsReviewer().catch((thrown: unknown) => thrown);
    expect(isAppError(forbidden) && forbidden.code).toBe("FORBIDDEN");
    expect(await getResourcePageByIdIn(db, eventId, protectedPage.pageId)).not.toBeNull();
  });
});

describe("excerptFromHtml: an excerpt that reads like something a person wrote", () => {
  it("leaves the heading to the body instead of fusing it into the sentence beneath it", () => {
    const body = "<h2>Welcome</h2><p>Check in at the Speaker Lounge at least 45 minutes before your session.</p>";
    expect(excerptFromHtml(body)).toBe("Check in at the Speaker Lounge at least 45 minutes before your session.");
  });

  it("keeps separate blocks separate: a sentence closes itself, a fragment gets a bullet", () => {
    const body = "<p>Everything you need before stage.</p><ul><li>Arrive 45 minutes early</li><li>Bring a backup deck</li></ul>";
    expect(excerptFromHtml(body)).toBe("Everything you need before stage. Arrive 45 minutes early · Bring a backup deck");
  });

  it("reads inline markup and entities as the text they render as", () => {
    expect(excerptFromHtml("<p><strong>Tea</strong> &amp; <em>coffee</em> are on us.</p>")).toBe("Tea & coffee are on us.");
  });

  it("falls back to the headings when a page has nothing but headings, rather than showing a blank card", () => {
    expect(excerptFromHtml("<h2>Draft — not yet published</h2>")).toBe("Draft — not yet published");
  });

  it("truncates on a word boundary", () => {
    const excerpt = excerptFromHtml("<p>Economy flights, with a Bay-Area-local exception for anyone within driving distance of the venue.</p>", 40);
    expect(excerpt).toBe("Economy flights, with a Bay-Area-local…");
    expect(excerpt.length).toBeLessThanOrEqual(41);
  });
});
