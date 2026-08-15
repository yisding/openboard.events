import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import * as schema from "@/db/schema";
import { organizationIdSchema, userIdSchema } from "@/shared/contracts";
import {
  listOrganizationOnboardingMilestonesIn,
  recordOrganizationOnboardingMilestoneIn,
  recordSignupEmailVerifiedIn,
  tryRecordOrganizationOnboardingMilestoneIn,
} from "./onboarding";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationMilestones = readFileSync(new URL("../../../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
// First Fair widened 0023's CHECK for the demo/tour milestones. Without it in
// this fixture the three new union members would raise a 23514 that
// `tryRecord…` swallows — which is exactly the silent-funnel failure the last
// test in this suite exists to make impossible.
const migrationDemoEvents = readFileSync(new URL("../../../../drizzle/0044_demo_events_and_tour.sql", import.meta.url), "utf8");

const userId = userIdSchema.parse("a2300000-0000-4000-8000-000000000001");
const organizationId = organizationIdSchema.parse("a2300000-0000-4000-8000-000000000011");
const otherOrganizationId = organizationIdSchema.parse("a2300000-0000-4000-8000-000000000012");

describe("privacy-safe onboarding milestones", () => {
  let pglite: PGlite;
  let database: DbOrTx;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationMilestones);
    await pglite.exec(migrationDemoEvents);
    database = drizzle(pglite, { schema }) as unknown as DbOrTx;
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'owner@example.com','Owner')", [userId]);
    await pglite.query(
      "INSERT INTO organizations(id,name,slug) VALUES($1,'Signal One','signal-one'),($2,'Signal Two','signal-two')",
      [organizationId, otherOrganizationId],
    );
  });

  afterAll(async () => pglite.close());

  it("stores one fixed first occurrence and never overwrites its actor or time", async () => {
    await expect(recordOrganizationOnboardingMilestoneIn(database, organizationId, "signup_completed", userId)).resolves.toBe(true);
    const first = (await listOrganizationOnboardingMilestonesIn(database, organizationId))[0];
    await expect(recordOrganizationOnboardingMilestoneIn(database, organizationId, "signup_completed", null)).resolves.toBe(false);
    expect(await listOrganizationOnboardingMilestonesIn(database, organizationId)).toEqual([first]);
  });

  it("correlates verification only to workspaces created by that signup", async () => {
    await expect(recordSignupEmailVerifiedIn(database, userId)).resolves.toBe(true);
    expect((await listOrganizationOnboardingMilestonesIn(database, organizationId)).map((row) => row.milestone).sort())
      .toEqual(["email_verified", "signup_completed"]);
    await expect(listOrganizationOnboardingMilestonesIn(database, otherOrganizationId)).resolves.toEqual([]);
  });

  /**
   * The union in `onboarding.ts` and the CHECK in the database are two halves
   * of one vocabulary. Because `tryRecord…` deliberately never turns a
   * completed customer action into a 500, a value present in only the
   * TypeScript half would not fail loudly — the funnel would just go dark.
   * These assertions go through `tryRecord…` for exactly that reason: it is
   * the swallowing caller, so `true` here proves the row really landed.
   */
  it("records the First Fair milestones through the swallowing writer, proving the widened CHECK applied", async () => {
    for (const milestone of ["demo_provisioned", "tour_completed", "real_event_after_demo"] as const) {
      await expect(tryRecordOrganizationOnboardingMilestoneIn(database, otherOrganizationId, milestone, userId)).resolves.toBe(true);
    }
    expect((await listOrganizationOnboardingMilestonesIn(database, otherOrganizationId)).map((row) => row.milestone).sort())
      .toEqual(["demo_provisioned", "real_event_after_demo", "tour_completed"]);
  });

  it("retains the aggregate after user deletion and erases it with the organization", async () => {
    await pglite.query("DELETE FROM users WHERE id=$1", [userId]);
    expect((await listOrganizationOnboardingMilestonesIn(database, organizationId)).every((row) => row.actorUserId === null)).toBe(true);
    await pglite.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
    await expect(listOrganizationOnboardingMilestonesIn(database, organizationId)).resolves.toEqual([]);
  });

  it("rejects arbitrary event names at the database boundary", async () => {
    await expect(pglite.query(
      "INSERT INTO organization_onboarding_milestones(organization_id,milestone) VALUES($1,'page_view')",
      [otherOrganizationId],
    )).rejects.toMatchObject({ code: "23514" });
  });
});
