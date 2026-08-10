import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { userIdSchema, type EventId, type UserId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { createEventIn, updateEventIn } from "./mutations";
import { getEventIn, listVocabIn } from "./queries";
import { deleteVocabItemIn, reorderVocabIn, saveVocabItemIn } from "./vocab";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");

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
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const [user] = await database.insert(schema.users).values({ email: "organizer@test.dev", name: "Test Organizer" }).returning();
    actorUserId = userIdSchema.parse(user?.id);
  }, 60_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("creates an event, grants the actor ownership, and seeds 8 templates + 5 formats", async () => {
    const event = await createEventIn(database, actorUserId, baseInput());
    expect(event.name).toBe("Builder Conf");
    expect(event.slug).toBe("builder-conf");
    expect(event.rowVersion).toBe(1);

    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [event.id]);
    expect(templates.rows[0]?.n).toBe(8);
    const formats = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_formats WHERE event_id=$1", [event.id]);
    expect(formats.rows[0]?.n).toBe(5);
    const membership = await pglite.query<{ role: string }>("SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2", [event.id, actorUserId]);
    expect(membership.rows[0]?.role).toBe("owner");
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
    expect(templates.rows[0]?.n).toBe(8);
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
