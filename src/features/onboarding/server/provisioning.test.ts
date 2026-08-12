import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { createOrganizationIn, getEventOrganizationIn, listOrganizationEventsIn } from "@/features/organizations";
import { DEFAULT_ORGANIZATION_ID, eventIdSchema, formIdSchema, TEMPLATE_KEYS, userIdSchema, type OrganizationId, type UserId } from "@/shared/contracts";
import { getActiveOrganizationOnboardingForUserIn, getActiveOrganizationOnboardingIn, updateOrganizationOnboardingIn } from "./progress";
import { provisionOrganizationEventIn } from "./provisioning";

// Same migration set `features/events/server/mutations.test.ts` needs for
// `createEventIn` (0004/0007/0008/0009 widen `template_key`, which
// `seedDefaultTemplates` inserts one row per key for), plus 0010 for
// `organizations`/`organization_id` and 0011 for `organization_invited`.
const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationProductAuth = readFileSync(new URL("../../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");
// M49 — `createOrganizationIn` now inserts an `organization_subscriptions` row,
// and `provisionOrganizationEventIn` now calls `assertOrganizationCanCreateEventIn`
// / `incrementOrganizationUsageIn`, so this suite needs the billing tables too.
const migrationBilling = readFileSync(new URL("../../../../drizzle/0012_billing_scaffold.sql", import.meta.url), "utf8");
const migrationOnboardingProgress = readFileSync(new URL("../../../../drizzle/0021_onboarding_progress.sql", import.meta.url), "utf8");
const migrationOnboardingMilestones = readFileSync(new URL("../../../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");

function baseInput(overrides: Partial<Parameters<typeof provisionOrganizationEventIn>[3]> = {}) {
  return {
    name: "Self-Serve Conf",
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

/**
 * M45 — the one seam this module closes: `organizationHomeEventId`
 * (`organizations/server/invitations.ts`) has said since M44 landed that a
 * freshly self-serve-signed-up organization has no home event "until M45's
 * event-creation flow lands". This suite is that landing: an event created
 * through the onboarding composition is never left under
 * `DEFAULT_ORGANIZATION_ID`, and it still gets everything `createEventIn`
 * alone already gives a bootstrapped admin — owner membership, 8 templates,
 * 5 formats — because this is that same function, not a parallel insert.
 */
describe("self-serve onboarding — provisionOrganizationEvent (M45)", () => {
  let pglite: PGlite;
  let database: DbOrTx;
  let actorUserId: UserId;
  let organizationId: OrganizationId;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationEmailCompliance);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationUserManagement);
    await pglite.exec(migrationBilling);
    await pglite.exec(migrationOnboardingProgress);
    await pglite.exec(migrationOnboardingMilestones);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;

    const [user] = await database.insert(schema.users).values({ email: "founder@test.dev", name: "Founder" }).returning();
    actorUserId = userIdSchema.parse(user?.id);
    const organization = await createOrganizationIn(database, actorUserId, { name: "Founder's Org" });
    organizationId = organization.id;
  }, 60_000);

  afterAll(async () => pglite.close());

  it("creates the event scoped to the organization, not the default one", async () => {
    const event = await provisionOrganizationEventIn(database, actorUserId, organizationId, baseInput());
    await expect(getEventOrganizationIn(database, event.id)).resolves.toBe(organizationId);
    await expect(getEventOrganizationIn(database, event.id)).resolves.not.toBe(DEFAULT_ORGANIZATION_ID);

    const orgEvents = await listOrganizationEventsIn(database, organizationId);
    expect(orgEvents.map((row) => row.id)).toContain(event.id);
    const milestones = await pglite.query<{ milestone: string; actor_user_id: string | null }>(
      "SELECT milestone, actor_user_id FROM organization_onboarding_milestones WHERE organization_id=$1",
      [organizationId],
    );
    expect(milestones.rows).toEqual([{ milestone: "event_created", actor_user_id: actorUserId }]);
  });

  it("still runs the full M11 create path underneath — owner membership + defaults", async () => {
    const event = await provisionOrganizationEventIn(database, actorUserId, organizationId, baseInput({ name: "Second Event" }));

    const membership = await pglite.query<{ role: string }>("SELECT role FROM event_members WHERE event_id=$1 AND user_id=$2", [event.id, actorUserId]);
    expect(membership.rows[0]?.role).toBe("owner");

    const templates = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM email_templates WHERE event_id=$1", [event.id]);
    expect(templates.rows[0]?.n).toBe(TEMPLATE_KEYS.length);
    const formats = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM session_formats WHERE event_id=$1", [event.id]);
    expect(formats.rows[0]?.n).toBe(5);
  });

  it("recovers a committed response by stable id without consuming another event or usage count", async () => {
    const stableId = eventIdSchema.parse("d7000000-0000-4000-8000-000000000090");
    const beforeUsage = await pglite.query<{ count: number }>(
      "SELECT count FROM organization_usage_counters WHERE organization_id=$1 AND metric='events'",
      [organizationId],
    );
    const input = baseInput({ id: stableId, name: "Retry-safe event", slug: "retry-safe-event" });

    const first = await provisionOrganizationEventIn(database, actorUserId, organizationId, input);
    await updateOrganizationOnboardingIn(database, actorUserId, organizationId, { eventId: stableId, step: "form" });
    const retry = await provisionOrganizationEventIn(database, actorUserId, organizationId, input);
    expect(retry.id).toBe(first.id);
    expect(await getEventOrganizationIn(database, stableId)).toBe(organizationId);

    const rows = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM events WHERE id=$1", [stableId]);
    const afterUsage = await pglite.query<{ count: number }>(
      "SELECT count FROM organization_usage_counters WHERE organization_id=$1 AND metric='events'",
      [organizationId],
    );
    expect(rows.rows[0]?.n).toBe(1);
    expect(afterUsage.rows[0]?.count ?? 0).toBe((beforeUsage.rows[0]?.count ?? 0) + 1);
    await expect(getActiveOrganizationOnboardingIn(database, organizationId)).resolves.toEqual({
      eventId: stableId,
      formId: null,
      step: "form",
    });
  });

  it("keeps resumable progress tenant-scoped, monotonic, and replay-safe", async () => {
    const [user] = await database.insert(schema.users).values({
      email: "resume-founder@test.dev",
      name: "Resume Founder",
    }).returning();
    const resumeUserId = userIdSchema.parse(user?.id);
    const resumeOrg = await createOrganizationIn(database, resumeUserId, {
      name: "Resume Org",
      slug: "resume-org",
    });
    const event = await provisionOrganizationEventIn(
      database,
      resumeUserId,
      resumeOrg.id,
      baseInput({ name: "Resume Event", slug: "resume-event" }),
    );

    await expect(getActiveOrganizationOnboardingIn(database, resumeOrg.id)).resolves.toEqual({
      eventId: event.id,
      formId: null,
      step: "vocabulary",
    });
    const onboardingFormId = formIdSchema.parse("e7000000-0000-4000-8000-000000000091");
    // Reserve the stable ID before the form exists, exactly as the browser
    // does before POST. A refresh can now retry this same ID safely.
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "form",
      formId: onboardingFormId,
    })).resolves.toMatchObject({ step: "form" });
    await expect(getActiveOrganizationOnboardingIn(database, resumeOrg.id)).resolves.toEqual({
      eventId: event.id,
      formId: onboardingFormId,
      step: "form",
    });
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "complete",
      formId: onboardingFormId,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const [unrelatedRow] = await database.insert(schema.forms).values([
      { eventId: event.id, context: "cfp", internalName: "Unrelated form", externalTitle: "Unrelated form" },
      { id: onboardingFormId, eventId: event.id, context: "cfp", internalName: "Onboarding form", externalTitle: "Onboarding form" },
    ]).returning();
    const unrelatedFormId = formIdSchema.parse(unrelatedRow?.id);
    const [collaborator] = await database.insert(schema.users).values({
      email: "resume-collaborator@test.dev",
      name: "Resume Collaborator",
    }).returning();
    const collaboratorId = userIdSchema.parse(collaborator?.id);
    await database.insert(schema.organizationMembers).values({
      organizationId: resumeOrg.id,
      userId: collaboratorId,
      role: "organizer",
    });
    await expect(getActiveOrganizationOnboardingForUserIn(database, resumeOrg.id, resumeUserId)).resolves.toMatchObject({
      eventId: event.id,
    });
    await expect(getActiveOrganizationOnboardingForUserIn(database, resumeOrg.id, collaboratorId)).resolves.toBeNull();
    await expect(updateOrganizationOnboardingIn(database, collaboratorId, resumeOrg.id, {
      eventId: event.id,
      step: "vocabulary",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "form",
      formId: unrelatedFormId,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "vocabulary",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateOrganizationOnboardingIn(database, actorUserId, organizationId, {
      eventId: event.id,
      step: "complete",
      formId: onboardingFormId,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "complete",
      formId: unrelatedFormId,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "complete",
      formId: onboardingFormId,
    })).resolves.toMatchObject({ step: "complete" });
    await expect(getActiveOrganizationOnboardingIn(database, resumeOrg.id)).resolves.toBeNull();
    // A stale form-association replay and a delayed stable event-create replay
    // both preserve the completed tombstone instead of restarting setup.
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "form",
      formId: onboardingFormId,
    })).resolves.toMatchObject({ step: "form" });
    await provisionOrganizationEventIn(database, resumeUserId, resumeOrg.id, baseInput({
      id: event.id,
      name: "Resume Event",
      slug: "resume-event",
    }));
    await expect(getActiveOrganizationOnboardingIn(database, resumeOrg.id)).resolves.toBeNull();
    const tombstone = await pglite.query<{ step: string; form_id: string }>(
      "SELECT step, form_id FROM event_onboarding_progress WHERE event_id=$1",
      [event.id],
    );
    expect(tombstone.rows[0]).toEqual({ step: "complete", form_id: onboardingFormId });
    await expect(updateOrganizationOnboardingIn(database, resumeUserId, resumeOrg.id, {
      eventId: event.id,
      step: "complete",
      formId: onboardingFormId,
    })).resolves.toMatchObject({ step: "complete" });
  });

  it("scopes a second organization's events independently", async () => {
    const [otherUser] = await database.insert(schema.users).values({ email: "other-founder@test.dev", name: "Other Founder" }).returning();
    const otherUserId = userIdSchema.parse(otherUser?.id);
    const otherOrg = await createOrganizationIn(database, otherUserId, { name: "Other Org" });

    const mine = await provisionOrganizationEventIn(database, actorUserId, organizationId, baseInput({ name: "Mine" }));
    const theirs = await provisionOrganizationEventIn(database, otherUserId, otherOrg.id, baseInput({ name: "Theirs" }));

    const mineList = await listOrganizationEventsIn(database, organizationId);
    const theirsList = await listOrganizationEventsIn(database, otherOrg.id);
    expect(mineList.map((row) => row.id)).toContain(mine.id);
    expect(mineList.map((row) => row.id)).not.toContain(theirs.id);
    expect(theirsList.map((row) => row.id)).toContain(theirs.id);
    expect(theirsList.map((row) => row.id)).not.toContain(mine.id);
  });

  /**
   * M49 — the events-per-org limit wired into this exact composition, in
   * front of `createEventIn` (so a plan at its cap never leaves an orphaned/
   * under-seeded row), plus the usage-counter increment that follows a
   * successful creation.
   */
  describe("the M49 entitlement gate", () => {
    it("blocks a 'free'-plan organization at its event cap, and still increments the usage counter for each event that was allowed through", async () => {
      const [user] = await database.insert(schema.users).values({ email: "capped-founder@test.dev", name: "Capped Founder" }).returning();
      const cappedUserId = userIdSchema.parse(user?.id);
      const cappedOrg = await createOrganizationIn(database, cappedUserId, { name: "Capped Via Onboarding", slug: "capped-via-onboarding" });

      for (let index = 0; index < 5; index += 1) {
        await provisionOrganizationEventIn(database, cappedUserId, cappedOrg.id, baseInput({ name: `Capped Event ${index}` }));
      }
      await expect(provisionOrganizationEventIn(database, cappedUserId, cappedOrg.id, baseInput({ name: "One Too Many" })))
        .rejects.toMatchObject({ code: "LIMIT_REACHED" });

      const orgEvents = await listOrganizationEventsIn(database, cappedOrg.id);
      expect(orgEvents).toHaveLength(5);
      const counter = await pglite.query<{ count: number }>(
        "SELECT count FROM organization_usage_counters WHERE organization_id=$1 AND metric='events'",
        [cappedOrg.id],
      );
      expect(counter.rows[0]?.count).toBe(5);
    });
  });
});
