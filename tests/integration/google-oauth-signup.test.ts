import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { db as RepositoryDb } from "@/db/client";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import { buildAdminAuth } from "@/features/auth/server/better-auth";
import { parseEnv } from "@/shared/lib/env";

/**
 * The write path better-auth's Google callback takes for a brand-new user —
 * `internalAdapter.createOAuthUser` — which no other test exercises: unlike
 * `/sign-up/email` it creates the user and the OAuth account in one internal
 * call, with no endpoint context for the `databaseHooks.user.create` hooks.
 *
 * Also pins the incident 0020_billing_catalog_reassert.sql repairs: a
 * `seed --wipe` truncated `billing_plans`, and from then on every signup —
 * Google and email alike — failed `createOrganizationIn`'s subscription
 * insert on organization_subscriptions_plan_id_fkey, which better-auth
 * reports only as its generic `unable_to_create_user`.
 */

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
  ADMIN_AUTH_PROVIDER: "better-auth",
  GOOGLE_CLIENT_ID: "test-google-client-id",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
});

function googleProfile(email: string, accountId: string) {
  return [
    { name: "New Organizer", image: "https://lh3.googleusercontent.com/a/example", email, emailVerified: true },
    {
      providerId: "google",
      accountId,
      accessToken: "ya29.test-access-token",
      refreshToken: undefined,
      idToken: "eyJ.test.idtoken",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshTokenExpiresAt: undefined,
      scope: "openid email profile",
    },
  ] as const;
}

describe("Google OAuth signup", () => {
  let pglite: PGlite;
  let database: typeof RepositoryDb;
  let auth: ReturnType<typeof buildAdminAuth>;

  const applyMigration = (name: string) =>
    pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));

  beforeAll(async () => {
    pglite = new PGlite();
    const migrations = readdirSync(new URL("../../drizzle", import.meta.url))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of migrations) {
      await pglite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8"));
    }
    database = drizzle(pglite, { schema }) as unknown as typeof RepositoryDb;
    auth = buildAdminAuth(env, { database });
  }, 120_000);

  afterAll(async () => pglite.close());

  it("creates the user, the google account, and a provisioned organization in one callback", async () => {
    const ctx = await auth.$context;
    const [profile, account] = googleProfile("new.organizer@gmail.com", "108234567890123456789");
    const result = await ctx.internalAdapter.createOAuthUser(profile, account);

    const createdUserId = result.user?.id;
    expect(createdUserId).toBeTruthy();
    expect(result.account?.providerId).toBe("google");
    const [row] = await database.select().from(users).where(eq(users.email, "new.organizer@gmail.com")).limit(1);
    expect(row?.emailVerified).toBe(true);

    // The M44 guarantee: no orphaned account through any signup door.
    const organizations = await pglite.query(
      "SELECT o.id FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = $1 AND m.role = 'owner'",
      [createdUserId],
    );
    expect(organizations.rows).toHaveLength(1);
    const subscription = await pglite.query(
      "SELECT plan_id FROM organization_subscriptions WHERE organization_id = $1",
      [(organizations.rows[0] as { id: string }).id],
    );
    expect((subscription.rows[0] as { plan_id: string }).plan_id).toBe("free");
  });

  it("re-applying 0020 repairs a wiped billing catalog and signup works again", async () => {
    // The incident: seed --wipe truncates every public table; the seed put the
    // organizations back but nothing restored the 0012-authored billing rows.
    await pglite.exec("TRUNCATE TABLE billing_plans CASCADE");

    const ctx = await auth.$context;
    const [profile, account] = googleProfile("blocked.organizer@gmail.com", "108234567890123456790");
    await expect(ctx.internalAdapter.createOAuthUser(profile, account)).rejects.toThrow();
    // The failed signup rolled its user back rather than stranding it.
    const stranded = await database.select({ id: users.id }).from(users)
      .where(eq(users.email, "blocked.organizer@gmail.com")).limit(1);
    expect(stranded).toHaveLength(0);

    await applyMigration("0020_billing_catalog_reassert");

    // The catalog is back, every organization has its subscription row again —
    // the default organization on 'enterprise', per 0012's backfill contract —
    // and the same sign-in now succeeds.
    const orphaned = await pglite.query(
      "SELECT count(*)::int AS n FROM organizations o LEFT JOIN organization_subscriptions s ON s.organization_id = o.id WHERE s.organization_id IS NULL",
    );
    expect((orphaned.rows[0] as { n: number }).n).toBe(0);
    const defaultPlan = await pglite.query(
      "SELECT plan_id FROM organization_subscriptions WHERE organization_id = 'd3fa0000-0000-4000-8000-000000000001'",
    );
    expect((defaultPlan.rows[0] as { plan_id: string }).plan_id).toBe("enterprise");

    const retry = await ctx.internalAdapter.createOAuthUser(...googleProfile("blocked.organizer@gmail.com", "108234567890123456790"));
    expect(retry.user?.id).toBeTruthy();
  });
});
