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
} from "./onboarding";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationMilestones = readFileSync(new URL("../../../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");

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
