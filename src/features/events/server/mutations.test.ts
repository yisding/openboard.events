import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { DEFAULT_ORGANIZATION_ID, organizationIdSchema, userIdSchema, type EventId, type UserId, TEMPLATE_KEYS } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { createEventIn, updateEventIn } from "./mutations";
import { getEventIn, listVocabIn } from "./queries";
import { deleteVocabItemIn, reorderVocabIn, saveVocabItemIn } from "./vocab";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
// M50 added `reviewer_invited`/`review_reminder` to `template_key`, which
// `TEMPLATE_KEYS.length` below (and every `seedDefaultTemplates` call inside
// `createEventIn`) already assumes — this fixture was missing the migration
// that makes those enum labels valid, independent of P3-EMAIL.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// P3-EMAIL added `events.physical_address`, which `createEventIn`/`updateEventIn`
// now write on every call.
const migrationEmailCompliance = readFileSync(new URL("../../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
// M51 added `speaker_bulk_message` to `template_key`, same reasoning as the
// migrationReviewOps comment above.
const migrationRoster = readFileSync(new URL("../../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M42 adds the admin_password_reset / admin_email_verification template keys,
// which `seedDefaultTemplates` inserts for every event.
const migrationProductAuth = readFileSync(new URL("../../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43 added `events.organization_id`. Drizzle names every mapped column on an
// insert (`… "organization_id" … values ($1, default, …)`), so `createEventIn`
// needs the column to exist even though this suite never asserts on it — the
// same reason the four migrations above are applied here.
const migrationTenancy = readFileSync(new URL("../../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
// M44 appended `organization_invited` to `template_key`, same reasoning as
// `migrationProductAuth` above.
const migrationUserManagement = readFileSync(new URL("../../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");

function baseInput(overrides: Partial<Parameters<typeof createEventIn>[2]> = {}) {
  return {
    name: "Builder Conf",
    eventType: "conference" as const,
    websiteUrl: "",
    location: "",
    timezone: "America/Los_Angeles",
    startsAt: "2026-09-15T16:00:00.000Z",
    endsAt: "2026-09-17T01:00:00.000Z",
    theme: "",
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  const result = await promise.catch((error: unknown) => error);
  return isAppError(result) ? result.code : null;
}

describe("database-backed event mutations", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let actorUserId: UserId;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationUserManagement);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const [user] = await database.insert(schema.users).values({ email: "organizer@test.dev", name: "Test Organizer" }).returning();
    actorUserId = userIdSchema.parse(user?.id);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("creates an event, grants the actor ownership, and seeds one template per key + 5 formats", async () => {
    const event = await createEventIn(database, actorUserId, baseInput());
    expect(event.name).toBe("Builder Conf");
    expect(event.slug).toBe("builder-conf");
    expect(event.rowVersion).toBe(1);

    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [event.id]);
    expect(templates.rows[0]?.n).toBe(TEMPLATE_KEYS.length);
    const formats = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_formats WHERE event_id=$1", [event.id]);
    expect(formats.rows[0]?.n).toBe(5);
    const membership = await pglite.query<{ role: string }>("SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2", [event.id, actorUserId]);
    expect(membership.rows[0]?.role).toBe("owner");
  });

  /**
   * M43's `events.organization_id` column DEFAULT is the migration's
   * compatibility hinge — it is what let seeds and ~40 fixtures keep inserting
   * events with no organization named. It was also, until this parameter
   * existed, the *tenancy policy* for every request-driven create: the legacy
   * hub (`POST /api/internal/events`) named no organization, so a self-serve
   * organization's event silently landed in the shared default tenant, where
   * its own team's organization surfaces could not see it.
   */
  it("files an event under the organization it is given, and under the column default when it is not", async () => {
    const [organization] = await database.insert(schema.organizations)
      .values({ name: "Tenant Zero", slug: "tenant-zero" })
      .returning();
    const organizationId = organizationIdSchema.parse(organization?.id);

    const scoped = await createEventIn(database, actorUserId, baseInput({ name: "Scoped Conf", slug: "scoped-conf" }), organizationId);
    const scopedRow = await pglite.query<{ organization_id: string }>("SELECT organization_id FROM events WHERE id=$1", [scoped.id]);
    expect(scopedRow.rows[0]?.organization_id).toBe(organizationId);

    const unscoped = await createEventIn(database, actorUserId, baseInput({ name: "Default Conf", slug: "default-conf" }));
    const unscopedRow = await pglite.query<{ organization_id: string }>("SELECT organization_id FROM events WHERE id=$1", [unscoped.id]);
    expect(unscopedRow.rows[0]?.organization_id).toBe(DEFAULT_ORGANIZATION_ID);
  });

  it("rejects a reserved slug", async () => {
    expect(await codeOf(createEventIn(database, actorUserId, baseInput({ name: "Portal Days", slug: "portal" })))).toBe("VALIDATION");
  });

  it("rejects endsAt <= startsAt even when the caller bypasses the zod refine", async () => {
    expect(await codeOf(createEventIn(database, actorUserId, baseInput({
      name: "Backwards Conf",
      startsAt: "2026-09-17T01:00:00.000Z",
      endsAt: "2026-09-15T16:00:00.000Z",
    })))).toBe("VALIDATION");
  });

  it("rejects an unknown timezone", async () => {
    expect(await codeOf(createEventIn(database, actorUserId, baseInput({ name: "Nowhere Conf", timezone: "Nowhere/Nowhere" })))).toBe("VALIDATION");
  });

  it("maps a genuine slug collision to a friendly VALIDATION, not a 500", async () => {
    await createEventIn(database, actorUserId, baseInput({ name: "Taken Conf", slug: "taken-conf" }));
    const failure = await createEventIn(database, actorUserId, baseInput({ name: "Taken Conf Two", slug: "taken-conf" })).catch((error: unknown) => error);
    expect(isAppError(failure) && failure.code).toBe("VALIDATION");
    expect(isAppError(failure) && failure.message).toBe("That slug is taken");
  });

  it("heals a half-created orphan on retry instead of reporting the slug taken", async () => {
    // Simulate the failure window the work order describes: the event row
    // exists, but the process died before either seeding call ran.
    const orphanId = "a0000000-0000-4000-8000-000000000001" as EventId;
    await pglite.query(
      "INSERT INTO events(id,name,slug,timezone,starts_at,ends_at) VALUES($1,'Orphan Conf','orphan-conf','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [orphanId],
    );
    const templatesBefore = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [orphanId]);
    expect(templatesBefore.rows[0]?.n).toBe(0);

    const healed = await createEventIn(database, actorUserId, baseInput({ name: "Orphan Conf", slug: "orphan-conf" }));
    expect(healed.id).toBe(orphanId);

    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [orphanId]);
    expect(templates.rows[0]?.n).toBe(TEMPLATE_KEYS.length);
    const formats = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_formats WHERE event_id=$1", [orphanId]);
    expect(formats.rows[0]?.n).toBe(5);
  });

  it("refuses to hand ownership of a live event to a different admin, even when its format/template counts dip below the under-seeded thresholds", async () => {
    // A real owner creates a normal, fully-seeded event.
    const owner = await createEventIn(database, actorUserId, baseInput({ name: "Live Conf", slug: "live-conf" }));

    // The owner legitimately trims default formats down to below 5 (e.g.
    // deletes "Break") — this alone must never look like an orphan.
    const [, , , , fifthFormat] = await listVocabIn(database, owner.id, "formats");
    if (!fifthFormat) throw new Error("expected the owner's event to be seeded with 5 default formats");
    await deleteVocabItemIn(database, owner.id, "formats", fifthFormat.id);
    const formatsAfterTrim = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_formats WHERE event_id=$1", [owner.id]);
    expect(formatsAfterTrim.rows[0]?.n).toBe(4);

    // A second, unrelated admin attempts to "create" an event with the same
    // slug — this must be rejected as taken, not silently heal-and-grant
    // them ownership of the victim's live event.
    const [attackerUser] = await database.insert(schema.users).values({ email: "attacker@test.dev", name: "Attacker" }).returning();
    const attackerUserId = userIdSchema.parse(attackerUser?.id);
    const failure = await createEventIn(database, attackerUserId, baseInput({ name: "Live Conf", slug: "live-conf" })).catch((error: unknown) => error);
    expect(isAppError(failure) && failure.code).toBe("VALIDATION");
    expect(isAppError(failure) && failure.message).toBe("That slug is taken");

    const membership = await pglite.query<{ role: string }>(
      "SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2",
      [owner.id, attackerUserId],
    );
    expect(membership.rows).toHaveLength(0);
  });

  it("STALE_WRITEs a second update that reuses the first update's expected rowVersion", async () => {
    const event = await createEventIn(database, actorUserId, baseInput({ name: "Version Conf", slug: "version-conf" }));
    const firstUpdate = await updateEventIn(database, event.id, { name: "Version Conf (renamed)" }, event.rowVersion);
    expect(firstUpdate.rowVersion).toBe(event.rowVersion + 1);

    expect(await codeOf(updateEventIn(database, event.id, { name: "Version Conf (again)" }, event.rowVersion))).toBe("STALE_WRITE");

    // The row is untouched by the losing call.
    const current = await getEventIn(database, event.id);
    expect(current?.name).toBe("Version Conf (renamed)");
  });

  it("round-trips the CAN-SPAM physical address, clearing it on an explicit empty string", async () => {
    const event = await createEventIn(database, actorUserId, baseInput({ name: "Address Conf", slug: "address-conf" }));
    expect(event.physicalAddress).toBeNull();

    const withAddress = await updateEventIn(database, event.id, { physicalAddress: "123 Main St, Suite 100, San Francisco, CA 94105" }, event.rowVersion);
    expect(withAddress.physicalAddress).toBe("123 Main St, Suite 100, San Francisco, CA 94105");

    const cleared = await updateEventIn(database, event.id, { physicalAddress: "" }, withAddress.rowVersion);
    expect(cleared.physicalAddress).toBeNull();
  });

  it("rejects endsAt <= startsAt on update", async () => {
    const event = await createEventIn(database, actorUserId, baseInput({ name: "Update Bounds Conf", slug: "update-bounds-conf" }));
    expect(await codeOf(updateEventIn(database, event.id, {
      startsAt: "2026-09-17T01:00:00.000Z",
      endsAt: "2026-09-15T16:00:00.000Z",
      timezone: "America/Los_Angeles",
    }, event.rowVersion))).toBe("VALIDATION");
  });

  it("round-trips vocabulary create, duplicate-name rejection, update, delete and whole-list reorder", async () => {
    const event = await createEventIn(database, actorUserId, baseInput({ name: "Vocab Conf", slug: "vocab-conf" }));

    const first = await saveVocabItemIn(database, event.id, "tracks", { name: "AI Agents" });
    const duplicate = await saveVocabItemIn(database, event.id, "tracks", { name: "AI Agents" }).catch((error: unknown) => error);
    expect(isAppError(duplicate) && duplicate.code).toBe("VALIDATION");
    expect(isAppError(duplicate) && duplicate.message.includes("already exists")).toBe(true);

    const second = await saveVocabItemIn(database, event.id, "tracks", { name: "Platforms" });
    const third = await saveVocabItemIn(database, event.id, "tracks", { name: "Security" });

    await saveVocabItemIn(database, event.id, "tracks", { id: first.id, name: "AI Agents (renamed)", color: "#123456" });
    const afterUpdate = await listVocabIn(database, event.id, "tracks");
    expect(afterUpdate.find((track) => track.id === first.id)?.name).toBe("AI Agents (renamed)");

    // Reorder to [third, first, second] and confirm it sticks.
    await reorderVocabIn(database, event.id, "tracks", [third.id, first.id, second.id]);
    const reordered = await listVocabIn(database, event.id, "tracks");
    expect(reordered.map((track) => track.id)).toEqual([third.id, first.id, second.id]);

    // Re-running the same order is a no-op.
    await reorderVocabIn(database, event.id, "tracks", [third.id, first.id, second.id]);
    const reorderedAgain = await listVocabIn(database, event.id, "tracks");
    expect(reorderedAgain.map((track) => track.id)).toEqual([third.id, first.id, second.id]);

    expect(await codeOf(reorderVocabIn(database, event.id, "tracks", [third.id, first.id]))).toBe("VALIDATION");

    await deleteVocabItemIn(database, event.id, "tracks", second.id);
    const afterDelete = await listVocabIn(database, event.id, "tracks");
    expect(afterDelete.map((track) => track.id)).toEqual([third.id, first.id]);

    // A second delete of the same id is a silent no-op, not an error.
    await expect(deleteVocabItemIn(database, event.id, "tracks", second.id)).resolves.toBeUndefined();
  });

  it("rejects manual reordering of tags — the schema carries no sort_order for them", async () => {
    const event = await createEventIn(database, actorUserId, baseInput({ name: "Tags Conf", slug: "tags-conf" }));
    await saveVocabItemIn(database, event.id, "tags", { name: "Evals" });
    expect(await codeOf(reorderVocabIn(database, event.id, "tags", ["00000000-0000-4000-8000-000000000000"]))).toBe("VALIDATION");
  });
});
