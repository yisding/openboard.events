import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  advanceDemoProvisioningIn,
  deleteDemoEventForActorIn,
  DEMO_RUNNABLE_PHASES,
  demoEventId,
} from "@/features/onboarding";
import { createOrganizationIn } from "@/features/organizations";
import { organizationIdSchema, userIdSchema, type OrganizationId, type UserId } from "@/shared/contracts";
import { applyProductMigrations } from "../../scripts/lib/product-migrations";

/**
 * First Fair — two organizations' demo worlds in one database.
 *
 * This is the test that retires the single biggest risk in lifting the
 * command-line seed to runtime. `scripts/seed`'s `seedId(kind, key)` is a uuid
 * over one fixed global namespace with no tenant component: perfectly fine for
 * the one standing sandbox database it was written for, and fatal the moment a
 * second organization provisions the same world, because essentially every
 * child row would collide on its primary key.
 *
 * The runtime path never calls `seedId`. Everything here is
 * `stableUuid(eventId, key)` with the event id itself namespaced under the
 * organization — and the three global-unique surfaces that ids alone do not
 * cover (`events.slug`, `contacts(event_id, email)`,
 * `communication_logs.idempotency_key`) are each asserted below rather than
 * assumed.
 */

/** Every table the provisioner writes into, checked for cross-tenant leakage. */
const TENANT_TABLES = [
  "tracks", "rooms", "session_formats", "tags", "email_templates", "contacts",
  "forms", "form_sections", "form_fields", "form_versions", "routing_rules",
  "submissions", "submission_participants", "submission_answers", "submission_tags",
  "event_members", "event_demo_tour",
] as const;

describe("two organizations, one database", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let alice: UserId;
  let bob: UserId;
  let alicesOrg: OrganizationId;
  let bobsOrg: OrganizationId;

  const inTransaction = <T,>(work: (tx: TxDb) => Promise<T>): Promise<T> => work(database as TxDb);

  async function provisionFully(actor: UserId, organizationId: OrganizationId): Promise<void> {
    for (let step = 0; step < DEMO_RUNNABLE_PHASES.length; step += 1) {
      await advanceDemoProvisioningIn(database, actor, organizationId, { inTransaction });
    }
  }

  async function countsFor(eventId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of TENANT_TABLES) {
      const row = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE event_id = $1`,
        [eventId],
      );
      counts[table] = row.rows[0]?.n ?? 0;
    }
    return counts;
  }

  beforeAll(async () => {
    pglite = new PGlite();
    await applyProductMigrations(pglite);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    const users = await pglite.query<{ id: string }>(
      "INSERT INTO users(email,name) VALUES($1,$2),($3,$4) RETURNING id",
      ["alice@tenant-a.test", "Alice", "bob@tenant-b.test", "Bob"],
    );
    alice = userIdSchema.parse(users.rows[0]?.id);
    bob = userIdSchema.parse(users.rows[1]?.id);
    alicesOrg = organizationIdSchema.parse((await createOrganizationIn(database, alice, { name: "Tenant A", slug: "tenant-a" })).id);
    bobsOrg = organizationIdSchema.parse((await createOrganizationIn(database, bob, { name: "Tenant B", slug: "tenant-b" })).id);

    await provisionFully(alice, alicesOrg);
    await provisionFully(bob, bobsOrg);
  }, 300_000);

  afterAll(async () => {
    await pglite.close();
  });

  it("gives each organization its own event, with its own globally unique slug", async () => {
    const rows = await pglite.query<{ id: string; slug: string; organization_id: string }>(
      "SELECT id, slug, organization_id FROM events WHERE is_demo ORDER BY slug",
    );
    expect(rows.rows).toHaveLength(2);
    expect(new Set(rows.rows.map((row) => row.slug)).size).toBe(2);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(2);
    expect(rows.rows.map((row) => row.id).sort())
      .toEqual([demoEventId(alicesOrg), demoEventId(bobsOrg)].sort());
    expect(rows.rows.every((row) => row.slug.startsWith("ai-engineer-worlds-fair-demo-"))).toBe(true);
  });

  it("builds two complete, identically shaped worlds", async () => {
    const alices = await countsFor(demoEventId(alicesOrg));
    const bobs = await countsFor(demoEventId(bobsOrg));
    expect(bobs).toEqual(alices);
    expect(alices.contacts).toBe(18);
    expect(alices.submissions).toBe(24);
  });

  it("shares no primary key anywhere, in any table the provisioner writes to", async () => {
    // Only the tables that actually have a surrogate `id`; the join tables key
    // on their own parents and are covered by those parents' ids.
    const withIds = await pglite.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'id' AND table_name = ANY($1)`,
      [[...TENANT_TABLES]],
    );
    const tables = withIds.rows.map((row) => row.table_name);
    // A guard against this assertion quietly checking nothing.
    expect(tables.length).toBeGreaterThan(8);

    for (const table of tables) {
      const shared = await pglite.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} a
          JOIN ${table} b ON a.id = b.id AND a.event_id <> b.event_id`,
      );
      expect({ table, shared: shared.rows[0]?.n ?? 0 }).toEqual({ table, shared: 0 });
    }
  });

  it("reuses the same fictional addresses verbatim, because contacts are unique per event and not globally", async () => {
    const rows = await pglite.query<{ email: string; n: number }>(
      "SELECT email, count(*)::int AS n FROM contacts GROUP BY email ORDER BY email",
    );
    // Every one of the eighteen personas appears in both worlds under the same
    // address: `dana.whitfield@northline.demo.invalid` is not mangled per
    // tenant, because `contacts` is UNIQUE on `(event_id, email)`.
    expect(rows.rows).toHaveLength(18);
    expect(rows.rows.every((row) => row.n === 2)).toBe(true);
    expect(rows.rows.every((row) => row.email.endsWith(".demo.invalid"))).toBe(true);
  });

  it("keeps every globally unique outbox key distinct — the surface two designs would have died on", async () => {
    const duplicates = await pglite.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT idempotency_key FROM communication_logs GROUP BY idempotency_key HAVING count(*) > 1
       ) collisions`,
    );
    expect(duplicates.rows[0]?.n).toBe(0);
    // And nothing drainable was provisioned in the first place.
    const queued = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE status = 'queued'",
    );
    expect(queued.rows[0]?.n).toBe(0);
  });

  it("never writes a setup checkpoint for either organization", async () => {
    const progress = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM event_onboarding_progress");
    expect(progress.rows[0]?.n).toBe(0);
  });

  it("counts neither demo against a plan, and reports neither as a conversion", async () => {
    const usage = await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM organization_usage_counters WHERE metric = 'events'",
    );
    expect(usage.rows[0]?.n).toBe(0);
    const milestones = await pglite.query<{ milestone: string; n: number }>(
      "SELECT milestone, count(*)::int AS n FROM organization_onboarding_milestones GROUP BY milestone",
    );
    const byName = new Map(milestones.rows.map((row) => [row.milestone, row.n]));
    expect(byName.get("demo_provisioned")).toBe(2);
    expect(byName.get("event_created")).toBeUndefined();
  });

  it("rebuilds an identical world after a delete, at the same id and with no duplicate keys", async () => {
    const eventId = demoEventId(bobsOrg);
    const before = await countsFor(eventId);

    await deleteDemoEventForActorIn(database, bob, bobsOrg);
    const gone = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM events WHERE id = $1", [eventId]);
    expect(gone.rows[0]?.n).toBe(0);

    await provisionFully(bob, bobsOrg);
    expect(await countsFor(eventId)).toEqual(before);
    // Alice's world was never in the blast radius.
    expect((await countsFor(demoEventId(alicesOrg))).contacts).toBe(18);
  }, 300_000);
});
