import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { db as RepositoryDb } from "@/db/client";
import * as schema from "@/db/schema";
import { adminAccounts, adminSessions, adminVerifications, eventMembers, users } from "@/db/schema";
import { authorizeAdmin, hashPassword, requiredRoleForEventPath, roleSatisfies, verifyPassword } from "@/features/auth";
import { ADMIN_COOKIE, ADMIN_SESSION_COOKIES, hasAdminSessionCookie } from "@/features/auth/cookies";
import { SIGNUP_ORGANIZATION_HEADER } from "@/features/auth/signup-context";
import { hashAdminPassword, needsRehash, verifyAdminPassword } from "@/features/auth/server/admin-password";
import { upsertCredentialAccount } from "@/features/auth/server/credential-account";
import { buildAdminAuth } from "@/features/auth/server/better-auth";
import {
  createOrganizationIn,
  getOrganizationMemberRoleIn,
  inviteOrganizationMemberIn,
  issueOrganizationInvitationTokenIn,
} from "@/features/organizations";
import { parseEnv } from "@/shared/lib/env";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";

/**
 * M42 — the Better Auth admin provider, end to end against real Postgres.
 *
 * This is the S4 spike redone as a test: a legacy PBKDF2 credential signs in
 * through Better Auth's own HTTP handler, a session row lands in
 * `admin_sessions`, the hash is upgraded in place, and deleting the row locks
 * the session out. What it cannot prove is the *deployed* half — the Worker
 * bundle, the Google callback against Google, cookies over a real origin —
 * which is exactly what DECISIONS.md keeps the fallback shipping for.
 */

/**
 * Applied in two halves on purpose. 0009 backfills `admin_accounts` from the
 * `users.password_hash` values it finds, so seeding the pre-M42 world *between*
 * the halves is what makes that backfill's assertion mean anything — it is the
 * order the real upgrade runs in, against a database that already has
 * organizers in it.
 */
const MIGRATIONS_BEFORE_M42 = [
  "0000_init", "0001_views_triggers", "0002_admin_auth", "0003_jade_defaults",
  "0004_review_operations", "0005_rate_limits", "0006_content_deliverables",
  "0007_email_compliance", "0008_speaker_roster_operations",
];
const M42_MIGRATION = "0009_product_auth";
// M44 — applied after M42 so `databaseHooks.user.create.after`
// (`provisionOrganizationForNewUserIn`) has `organizations`/
// `organization_members`/`organization_invitations` to write to once
// self-serve signup is exercised below.
const POST_M42_MIGRATIONS = ["0010_organization_tenancy", "0011_user_management", "0012_billing_scaffold"];

const eventA = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const eventB = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const legacyUser = userIdSchema.parse("b0000000-0000-4000-8000-000000000011");
const modernUser = userIdSchema.parse("b0000000-0000-4000-8000-000000000012");
const reviewerUser = userIdSchema.parse("b0000000-0000-4000-8000-000000000013");

const LEGACY_PASSWORD = "legacy organizer passphrase";
const MODERN_PASSWORD = "modern organizer passphrase";
const RESET_PASSWORD = "freshly reset organizer passphrase";

const env = parseEnv({
  APP_ENV: "local",
  APP_BASE_URL: "http://localhost:3000",
  SESSION_SECRET: "test-session-secret-that-is-at-least-32-bytes",
  ADMIN_AUTH_PROVIDER: "better-auth",
});

describe("M42 admin auth on Better Auth", () => {
  let pglite: PGlite;
  let database: typeof RepositoryDb;
  let auth: ReturnType<typeof buildAdminAuth>;

  beforeAll(async () => {
    pglite = new PGlite();
    const apply = async (name: string) =>
      pglite.exec(readFileSync(new URL(`../../drizzle/${name}.sql`, import.meta.url), "utf8"));
    for (const name of MIGRATIONS_BEFORE_M42) await apply(name);
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'A','m42-a','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'B','m42-b','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventA, eventB],
    );
    // Seeded exactly the way the pre-M42 world creates accounts: a
    // `users.password_hash` written by the fallback's own hasher, and nothing
    // in `admin_accounts` beyond what 0009's backfill puts there.
    await pglite.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'legacy@example.com','Legacy Organizer',$4),($2,'modern@example.com','Modern Organizer',NULL),($3,'reviewer@example.com','Reviewer',NULL)",
      [legacyUser, modernUser, reviewerUser, await hashPassword(LEGACY_PASSWORD)],
    );
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$4,'organizer'),($2,$4,'owner'),($3,$4,'reviewer'),($3,$5,'owner')",
      [legacyUser, modernUser, reviewerUser, eventA, eventB],
    );

    // Now upgrade the populated database, exactly as the deployed branches will.
    await apply(M42_MIGRATION);
    for (const name of POST_M42_MIGRATIONS) await apply(name);

    database = drizzle(pglite, { schema }) as unknown as typeof RepositoryDb;
    auth = buildAdminAuth(env, { database });
  }, 60_000);

  afterAll(async () => pglite.close());

  async function signIn(email: string, password: string): Promise<Response> {
    return auth.handler(new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password }),
    }));
  }

  function sessionCookie(response: Response): string {
    return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
  }

  it("backfills a credential account for every pre-existing password, and none for accounts without one", async () => {
    const accounts = await database.select({ userId: adminAccounts.userId, password: adminAccounts.password })
      .from(adminAccounts).where(eq(adminAccounts.providerId, "credential"));
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.userId).toBe(legacyUser);
    // Copied verbatim — the migration must not attempt to re-hash anything.
    expect(needsRehash(accounts[0]?.password ?? "")).toBe(true);
    await expect(verifyAdminPassword({ hash: accounts[0]?.password ?? "", password: LEGACY_PASSWORD })).resolves.toBe(true);
  });

  it("signs a legacy PBKDF2 credential in and rehashes it in place — no forced reset (AC 1)", async () => {
    const response = await signIn("legacy@example.com", LEGACY_PASSWORD);
    expect(response.status).toBe(200);

    const [account] = await database.select({ password: adminAccounts.password })
      .from(adminAccounts)
      .where(and(eq(adminAccounts.userId, legacyUser), eq(adminAccounts.providerId, "credential")))
      .limit(1);
    expect(needsRehash(account?.password ?? "")).toBe(false);
    // The upgraded hash still verifies the same plaintext: the user never
    // learns a rehash happened.
    await expect(verifyAdminPassword({ hash: account?.password ?? "", password: LEGACY_PASSWORD })).resolves.toBe(true);

    // And the legacy column is untouched, so flipping ADMIN_AUTH_PROVIDER back
    // to `fallback` still signs this person in.
    const [user] = await database.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, legacyUser)).limit(1);
    await expect(verifyAdminPassword({ hash: user?.passwordHash ?? "", password: LEGACY_PASSWORD })).resolves.toBe(true);
  });

  it("signs in again after the rehash, and rejects the wrong password", async () => {
    await expect(signIn("legacy@example.com", LEGACY_PASSWORD).then((r) => r.status)).resolves.toBe(200);
    await expect(signIn("legacy@example.com", "not the password").then((r) => r.ok)).resolves.toBe(false);
  });

  it("writes a revocable server-side session row isolated from the portal tables (AC 3)", async () => {
    const response = await signIn("legacy@example.com", LEGACY_PASSWORD);
    expect(response.status).toBe(200);

    const rows = await database.select().from(adminSessions).where(eq(adminSessions.userId, legacyUser));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.token).toBeTruthy();
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Speaker auth does not move in M42: nothing was written to its tables.
    const portalSessions = await pglite.query("SELECT count(*)::int AS n FROM portal_sessions");
    const portalTokens = await pglite.query("SELECT count(*)::int AS n FROM portal_tokens");
    expect((portalSessions.rows[0] as { n: number }).n).toBe(0);
    expect((portalTokens.rows[0] as { n: number }).n).toBe(0);
  });

  it("resolves a session from its cookie, and stops resolving it the moment the row is deleted (AC 4)", async () => {
    const response = await signIn("legacy@example.com", LEGACY_PASSWORD);
    const cookie = sessionCookie(response);
    expect(cookie).not.toBe("");

    const before = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(before?.user.email).toBe("legacy@example.com");

    // Revocation is a row delete — `revokeAdminSessions` in admin.ts issues
    // exactly this statement. No cookie cache stands between the delete and the
    // next request.
    await database.delete(adminSessions).where(eq(adminSessions.userId, legacyUser));

    const after = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(after).toBeNull();
  });

  it("keeps requireAdmin's authorization decisions identical to the fallback's (AC 2)", async () => {
    // `authorizeAdmin` is the shared half both providers run: same membership
    // lookup, same ranking, same FORBIDDEN. Only the identity source differs,
    // so pinning it here pins both providers.
    const legacy = { userId: legacyUser, email: "legacy@example.com", name: "Legacy Organizer" };
    const reviewer = { userId: reviewerUser, email: "reviewer@example.com", name: "Reviewer" };

    await expect(authorizeAdmin(database, legacy, eventA, "reviewer")).resolves.toMatchObject({ role: "organizer" });
    await expect(authorizeAdmin(database, legacy, eventA, "organizer")).resolves.toMatchObject({ role: "organizer" });
    await expect(authorizeAdmin(database, legacy, eventA, "owner")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeAdmin(database, reviewer, eventA, "organizer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeAdmin(database, reviewer, eventB, "owner")).resolves.toMatchObject({ role: "owner" });
    await expect(authorizeAdmin(database, legacy, eventB)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // An event that does not exist answers exactly like one the caller is not a
    // member of. The membership lookup runs *before* any event row is read —
    // `createImpersonationLink`'s `NOT_FOUND` sits behind `requireAdmin` for
    // this reason — so a signed-in organizer cannot probe which event ids are
    // real by reading the error back.
    const unknownEvent = eventIdSchema.parse("b0000000-0000-4000-8000-0000000000ff");
    await expect(authorizeAdmin(database, legacy, unknownEvent)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeAdmin(database, reviewer, unknownEvent, "reviewer")).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(roleSatisfies("owner", "reviewer")).toBe(true);
    expect(roleSatisfies("reviewer", "organizer")).toBe(false);
    expect(requiredRoleForEventPath(eventA, `/events/${eventA}/review`)).toBe("reviewer");
    expect(requiredRoleForEventPath(eventA, `/events/${eventA}/settings`)).toBe("organizer");
  });

  it("refuses an account with no credential row rather than inventing one", async () => {
    // `modern@example.com` has no `users.password_hash`, so 0009 gave it no
    // credential account. It must not be signable-into by any password.
    await expect(signIn("modern@example.com", MODERN_PASSWORD).then((r) => r.ok)).resolves.toBe(false);
  });

  it("lets provisioning mint a credential account that Better Auth accepts", async () => {
    // The path `createEventReviewer` and `bootstrap-admin.ts` now take: write
    // `users.password_hash`, mirror it into `admin_accounts`. Without the
    // mirror this account would be an orphan the moment the switch flipped.
    const passwordHash = await hashAdminPassword(MODERN_PASSWORD);
    await database.update(users).set({ passwordHash }).where(eq(users.id, modernUser));
    await upsertCredentialAccount(database, modernUser, passwordHash);

    await expect(signIn("modern@example.com", MODERN_PASSWORD).then((r) => r.status)).resolves.toBe(200);

    // Re-running provisioning updates the one row rather than colliding on the
    // (provider_id, account_id) unique index.
    const rotated = await hashAdminPassword(`${MODERN_PASSWORD} rotated`);
    await upsertCredentialAccount(database, modernUser, rotated);
    const accounts = await database.select().from(adminAccounts)
      .where(and(eq(adminAccounts.userId, modernUser), eq(adminAccounts.providerId, "credential")));
    expect(accounts).toHaveLength(1);
    await expect(signIn("modern@example.com", `${MODERN_PASSWORD} rotated`).then((r) => r.status)).resolves.toBe(200);
  });

  // M44 opened self-serve signup on this exact endpoint — superseding the
  // M42-era "keeps self-serve signup closed" case this replaces. The org
  // auto-provisioning it triggers (`databaseHooks.user.create.after`) is
  // covered in depth by `tests/integration/user-management.test.ts`; this
  // case only pins that the endpoint itself now succeeds and that the
  // account it creates is real, on this same Better Auth instance.
  it("opens self-serve signup (M44) — the account is created and can sign in", async () => {
    const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: "stranger@example.com", password: "a perfectly fine password", name: "Stranger" }),
    }));
    expect(response.ok).toBe(true);
    const [stranger] = await database.select().from(users).where(eq(users.email, "stranger@example.com")).limit(1);
    expect(stranger).toBeDefined();
    await expect(signIn("stranger@example.com", "a perfectly fine password").then((r) => r.status)).resolves.toBe(200);
  });

  it("accepts only the invitation token carried by signup and returns the correct workspace destination", async () => {
    const organization = await createOrganizationIn(database, legacyUser, { name: "Inviting Org", slug: "inviting-org" });
    try {
      const { invitation } = await inviteOrganizationMemberIn(database, organization.id, legacyUser, {
        email: "invited-through-signup@example.com",
        role: "organizer",
      });
      const issued = await issueOrganizationInvitationTokenIn(database, invitation.id);
      if (!issued) throw new Error("expected a live invitation token");

      const wrongAddress = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: "wrong-invite-address@example.com",
          password: "a perfectly fine password",
          name: "Wrong Address",
          invitationToken: issued.raw,
        }),
      }));
      expect(wrongAddress.ok).toBe(false);
      const wrongUser = await database.select({ id: users.id }).from(users)
        .where(eq(users.email, "wrong-invite-address@example.com")).limit(1);
      expect(wrongUser).toHaveLength(0);

      const response = await auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          email: "invited-through-signup@example.com",
          password: "a perfectly fine password",
          name: "Invited Signup",
          invitationToken: issued.raw,
        }),
      }));
      expect(response.ok).toBe(true);
      expect(response.headers.get(SIGNUP_ORGANIZATION_HEADER)).toBe(organization.id);
      const [newUser] = await database.select({ id: users.id }).from(users)
        .where(eq(users.email, "invited-through-signup@example.com")).limit(1);
      expect(newUser?.id).toBeTruthy();
      await expect(getOrganizationMemberRoleIn(database, organization.id, userIdSchema.parse(newUser?.id)))
        .resolves.toBe("organizer");
    } finally {
      await pglite.query("DELETE FROM organizations WHERE id=$1", [organization.id]);
      await pglite.query("DELETE FROM users WHERE email IN ('invited-through-signup@example.com','wrong-invite-address@example.com')");
    }
  });

  it("issues a session cookie the /events middleware gate recognises", async () => {
    // The gate in `src/middleware.ts` matches cookie *names*, and it cannot
    // read `ADMIN_AUTH_PROVIDER` from the edge — so the names in
    // `ADMIN_SESSION_COOKIES` have to match what Better Auth really sets, or a
    // signed-in admin is redirected to /login, `LoginForm` replaces back to
    // /events, and the app loops. This asserts the real Set-Cookie header, not
    // a restatement of the constant.
    const response = await signIn("legacy@example.com", LEGACY_PASSWORD);
    const names = response.headers.getSetCookie().map((cookie) => cookie.split("=")[0] ?? "");
    expect(names.some((name) => ADMIN_SESSION_COOKIES.includes(name))).toBe(true);
    expect(hasAdminSessionCookie(names)).toBe(true);
    // And the fallback's own cookie name still opens it, so flipping the
    // provider back does not lock anybody out of the gate either.
    expect(hasAdminSessionCookie([ADMIN_COOKIE])).toBe(true);
    expect(hasAdminSessionCookie(["ob_portal_something"])).toBe(false);
  });

  it("mirrors a reset password back to users.password_hash so the fallback stays usable", async () => {
    // Drive Better Auth's own reset endpoint the way a real reset link does:
    // the verification row is what `request-password-reset` writes, and the
    // token is what the emailed URL carries.
    const token = "m42-reset-token";
    const before = (await database.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, legacyUser)).limit(1))[0]?.passwordHash ?? "";
    await database.insert(adminVerifications).values({
      identifier: `reset-password:${token}`,
      value: legacyUser,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const response = await auth.handler(new Request("http://localhost:3000/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ token, newPassword: RESET_PASSWORD }),
    }));
    expect(response.ok).toBe(true);

    const [account] = await database.select({ password: adminAccounts.password })
      .from(adminAccounts)
      .where(and(eq(adminAccounts.userId, legacyUser), eq(adminAccounts.providerId, "credential")))
      .limit(1);
    await expect(verifyAdminPassword({ hash: account?.password ?? "", password: RESET_PASSWORD })).resolves.toBe(true);

    const [user] = await database.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, legacyUser)).limit(1);
    expect(user?.passwordHash).not.toBe(before);
    // The whole point: flip `ADMIN_AUTH_PROVIDER` back to `fallback` and the
    // *new* password works while the reset-away-from one does not. Before the
    // mirror, this assertion was exactly inverted.
    await expect(verifyPassword(RESET_PASSWORD, user?.passwordHash ?? "")).resolves.toBe(true);
    await expect(verifyPassword(LEGACY_PASSWORD, user?.passwordHash ?? "")).resolves.toBe(false);
  });

  it("mirrors a self-serve signup's password too, so the account is not fallback-only-locked-out", async () => {
    const [stranger] = await database.select({ id: users.id, passwordHash: users.passwordHash })
      .from(users).where(eq(users.email, "stranger@example.com")).limit(1);
    expect(stranger?.passwordHash).toBeTruthy();
    await expect(verifyPassword("a perfectly fine password", stranger?.passwordHash ?? "")).resolves.toBe(true);
  });

  it("does not disturb the event_members rows it authorizes against", async () => {
    const members = await database.select().from(eventMembers);
    expect(members).toHaveLength(4);
  });
});
