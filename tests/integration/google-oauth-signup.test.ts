import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { db as RepositoryDb } from "@/db/client";
import * as schema from "@/db/schema";
import { userLegalAcceptances, users } from "@/db/schema";
import { buildAdminAuth } from "@/features/auth/server/better-auth";
import { OAUTH_SIGNUP_INTENT_COOKIE, sealOAuthSignupIntent } from "@/features/auth/server/oauth-signup-intent";
import { toBase64Url } from "@/features/auth/server/crypto";
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

function unsignedGoogleIdToken(profile: { sub: string; email: string; name: string }) {
  const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    ...profile,
    email_verified: true,
    picture: "https://lh3.googleusercontent.com/a/example",
  })}.signature`;
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
    expect(auth.options.socialProviders?.google?.disableImplicitSignUp).toBe(true);
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

  it("refuses to create an unknown Google identity through ordinary sign-in", async () => {
    const email = "ordinary-login-only@gmail.com";
    const start = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/organizations",
        errorCallbackURL: "/login?next=%2Forganizations",
        requestSignUp: false,
      }),
    }));
    const authorization = new URL(((await start.json()) as { url: string }).url);
    const stateCookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const idToken = unsignedGoogleIdToken({
      sub: "108234567890123456794",
      email,
      name: "Unknown Organizer",
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: "ya29.test-unknown-user-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken,
    })));

    try {
      const callback = new URL("http://localhost:3000/api/auth/callback/google");
      callback.searchParams.set("code", "unknown-user-authorization-code");
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      const response = await auth.handler(new Request(callback, { headers: { cookie: stateCookies } }));

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location") ?? "", "http://localhost:3000");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe("/organizations");
      expect(location.searchParams.get("error")).toBe("signup_disabled");
      await expect(database.select({ id: users.id }).from(users).where(eq(users.email, email)))
        .resolves.toHaveLength(0);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("continues to sign in an existing Google identity through the ordinary door", async () => {
    const start = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/organizations",
        errorCallbackURL: "/login?next=%2Forganizations",
        requestSignUp: false,
      }),
    }));
    const authorization = new URL(((await start.json()) as { url: string }).url);
    const stateCookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const idToken = unsignedGoogleIdToken({
      sub: "108234567890123456789",
      email: "new.organizer@gmail.com",
      name: "New Organizer",
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: "ya29.test-existing-login-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken,
    })));

    try {
      const callback = new URL("http://localhost:3000/api/auth/callback/google");
      callback.searchParams.set("code", "existing-login-authorization-code");
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      const response = await auth.handler(new Request(callback, { headers: { cookie: stateCookies } }));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/organizations");
      expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith("openboard_admin.session_token=")))
        .toBe(true);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("returns an existing Google identity to the invitation acceptance URL", async () => {
    const invitationPath = "/join?token=existing-user-invitation";
    const start = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: invitationPath,
        newUserCallbackURL: "/organizations",
        requestSignUp: true,
      }),
    }));
    const authorization = new URL(((await start.json()) as { url: string }).url);
    const stateCookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const idToken = unsignedGoogleIdToken({
      sub: "108234567890123456789",
      email: "new.organizer@gmail.com",
      name: "New Organizer",
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: "ya29.test-existing-user-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken,
    })));

    try {
      const callback = new URL("http://localhost:3000/api/auth/callback/google");
      callback.searchParams.set("code", "existing-user-authorization-code");
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      const response = await auth.handler(new Request(callback, { headers: { cookie: stateCookies } }));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(invitationPath);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
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

  it("rejects a direct OAuth user-create bypass when reviewed signup consent is active", async () => {
    const guarded = buildAdminAuth(parseEnv({
      APP_ENV: "local",
      APP_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      LEGAL_TERMS_URL: "https://openboard.example/terms",
      LEGAL_TERMS_VERSION: "terms-2026-08",
      LEGAL_PRIVACY_URL: "https://openboard.example/privacy",
      LEGAL_PRIVACY_VERSION: "privacy-2026-08",
    }), { database });
    expect(guarded.options.socialProviders?.google?.disableImplicitSignUp).toBe(true);
    const ctx = await guarded.$context;
    const email = "oauth-without-consent@gmail.com";

    await expect(ctx.internalAdapter.createOAuthUser(...googleProfile(email, "108234567890123456791")))
      .rejects.toThrow(/Terms of Service/u);
    await expect(database.select({ id: users.id }).from(users).where(eq(users.email, email)))
      .resolves.toHaveLength(0);
  });

  it("completes an explicit Google callback with the encrypted workspace and consent context", async () => {
    const reviewedEnv = parseEnv({
      APP_ENV: "local",
      APP_BASE_URL: "http://localhost:3000",
      SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      LEGAL_TERMS_URL: "https://openboard.example/terms",
      LEGAL_TERMS_VERSION: "terms-2026-08",
      LEGAL_PRIVACY_URL: "https://openboard.example/privacy",
      LEGAL_PRIVACY_VERSION: "privacy-2026-08",
    });
    const guarded = buildAdminAuth(reviewedEnv, { database });
    const start = await guarded.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ provider: "google", callbackURL: "/organizations", requestSignUp: true }),
    }));
    const authorization = new URL(((await start.json()) as { url: string }).url);
    const stateCookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
    const intent = await sealOAuthSignupIntent({
      provider: "google",
      organizationName: "OAuth Events",
      legalVersions: { termsVersion: "terms-2026-08", privacyVersion: "privacy-2026-08" },
    }, reviewedEnv.SESSION_SECRET as string);
    const email = "explicit.oauth.organizer@gmail.com";
    const accountId = "108234567890123456792";
    const idToken = unsignedGoogleIdToken({ sub: accountId, email, name: "OAuth Organizer" });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://oauth2.googleapis.com/token");
      return Response.json({
        access_token: "ya29.test-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email profile",
        id_token: idToken,
      });
    }));

    try {
      const callback = new URL("http://localhost:3000/api/auth/callback/google");
      callback.searchParams.set("code", "test-authorization-code");
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      const response = await guarded.handler(new Request(callback, {
        headers: { cookie: `${stateCookies}; ${OAUTH_SIGNUP_INTENT_COOKIE}=${intent}` },
      }));

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/organizations");
      const [user] = await database.select({ id: users.id, emailVerified: users.emailVerified })
        .from(users).where(eq(users.email, email)).limit(1);
      expect(user?.emailVerified).toBe(true);
      const organization = await pglite.query(
        "SELECT o.name FROM organizations o JOIN organization_members m ON m.organization_id = o.id WHERE m.user_id = $1",
        [user?.id],
      );
      expect((organization.rows[0] as { name: string }).name).toBe("OAuth Events");
      const acceptance = await database.select({
        termsVersion: userLegalAcceptances.termsVersion,
        privacyVersion: userLegalAcceptances.privacyVersion,
      }).from(userLegalAcceptances).where(eq(userLegalAcceptances.userId, user?.id ?? ""));
      expect(acceptance).toEqual([{
        termsVersion: "terms-2026-08",
        privacyVersion: "privacy-2026-08",
      }]);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});
