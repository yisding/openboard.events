// `better-auth/minimal`, not `better-auth`: the package's root entry initialises
// through `context/init.ts`, which statically pulls in Kysely and the whole
// dialect-detection path so that `database:` can be a raw connection. We never
// use that door — `database:` below is always a `drizzleAdapter` — so on the
// root entry Kysely was several hundred KiB of Workers bundle that no request
// could ever reach. `better-auth/minimal` is upstream's supported entry for
// exactly this case (see its own doc comment: "For minimal mode (without
// Kysely), import from `better-auth/minimal`"). The only behaviour it removes
// is raw-connection support and `runMigrations`, both of which throw a clear
// BetterAuthError rather than misbehaving; we call neither — our schema is
// owned by the journaled `drizzle/` migrations, never by Better Auth.
import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { adminAccounts, adminSessions, adminVerifications, users } from "@/db/schema";
import { assertOrganizationInvitationTokenForEmailIn, provisionOrganizationForNewUserIn } from "@/features/organizations";
import { userIdSchema, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { SIGNUP_ORGANIZATION_HEADER } from "../signup-context";
import { hashAdminPassword, needsRehash, verifyAdminPassword } from "./admin-password";
import { sendAdminAuthEmail } from "./admin-mail";

/**
 * M42 — the Better Auth instance behind `requireAdmin`.
 *
 * Reachable only when `ADMIN_AUTH_PROVIDER=better-auth`; otherwise nothing in
 * this file is constructed and admin auth stays on the jose/PBKDF2 fallback
 * (`fallback-session.ts`). `admin.ts` is the only caller — the auth barrel's
 * exported surface, `requireAdmin(eventId, role?)` above all, is unchanged.
 *
 * Deliberate configuration choices:
 *
 * - **No `cookieCache`.** DECISIONS.md names the open bug: combined with
 *   `secondaryStorage` an expired cookie cache reads as a logout instead of a
 *   refresh. We use neither, and a cache would defeat the point anyway —
 *   revocation (AC 4) has to be visible on the very next request, which means
 *   reading `admin_sessions` every time.
 * - **`generateId: false`.** Ids come from the database's `gen_random_uuid()`
 *   defaults, so `admin_sessions.user_id` and friends stay `uuid` and keep
 *   their foreign keys to `users.id`.
 * - **`transaction: false`** (the adapter default, made explicit). The
 *   repository's `db` handle is `neon-http`, which cannot open one; PLAN
 *   resolution #4 confines transactions to eight audited functions and this is
 *   not one of them.
 * - **Google account linking on a trusted provider.** An organizer who already
 *   has a password account and then signs in with Google must land on the same
 *   `users` row — otherwise they arrive as a brand-new user with no
 *   `event_members` row and `requireAdmin` locks them out of their own event.
 */

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const RESET_TOKEN_SECONDS = 60 * 60;

function baseUrl(env: RuntimeEnv): string {
  return env.BETTER_AUTH_URL ?? env.APP_BASE_URL;
}

type AuthDeps = {
  /**
   * The Drizzle handle Better Auth reads and writes through. Defaults to the
   * repository's `neon-http` client; the integration tests pass a PGlite handle
   * so the whole sign-in round-trip — credential lookup, legacy-hash
   * verification, rehash, session row — runs against real Postgres.
   */
  database?: typeof db;
};

type SignupProvisioningInput = {
  invitationToken?: string;
  organizationName?: string;
};

function signupProvisioningInput(context: { path?: string; body?: unknown } | null): SignupProvisioningInput {
  if (context?.path !== "/sign-up/email" || !context.body || typeof context.body !== "object") return {};
  const body = context.body as Record<string, unknown>;
  const invitationToken = typeof body.invitationToken === "string" ? body.invitationToken.trim() : "";
  const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";
  return {
    ...(invitationToken.length > 0 && invitationToken.length <= 512 ? { invitationToken } : {}),
    ...(organizationName.length > 0 && organizationName.length <= 160 ? { organizationName } : {}),
  };
}

export function buildAdminAuth(env: RuntimeEnv, deps: AuthDeps = {}) {
  const database = deps.database ?? db;
  const secret = env.SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin authentication");
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : {};

  return betterAuth({
    appName: "openboard",
    secret,
    baseURL: baseUrl(env),
    basePath: "/api/auth",
    database: drizzleAdapter(database, {
      provider: "pg",
      transaction: false,
      schema: {
        user: users,
        session: adminSessions,
        account: adminAccounts,
        verification: adminVerifications,
      },
    }),
    advanced: {
      database: { generateId: false },
      // The fallback's cookie is `ADMIN_COOKIE`; a distinct prefix means the
      // two providers never read each other's cookie, so flipping
      // ADMIN_AUTH_PROVIDER back is a clean revert rather than a corrupt-token
      // error for everyone holding the other kind.
      cookiePrefix: "openboard_admin",
      useSecureCookies: env.APP_ENV !== "local",
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 24 * 60 * 60,
      // No `cookieCache` — see the header comment.
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
      // Resetting a password ends every other session for that account. A
      // reset is what somebody does when they believe their credential leaked.
      //
      // This revokes `admin_sessions` rows only. The fallback provider's
      // cookie is a stateless jose JWT with no server record, so a reset
      // performed while `ADMIN_AUTH_PROVIDER=better-auth` cannot end a
      // fallback cookie minted before the switch — see
      // `mirrorCredentialToFallback` below for the half of that problem that
      // *is* fixable (the credential itself) and `revokeAdminSessions`'
      // comment in `admin.ts` for why the other half is exactly what M42
      // exists to close.
      revokeSessionsOnPasswordReset: true,
      // Every password Better Auth writes is mirrored back into
      // `users.password_hash` — the reverse of what `upsertCredentialAccount`
      // does for provisioning. Without it a reset left the *old* (possibly
      // compromised) password authenticating on the fallback, and a password
      // first set under Better Auth did not exist on the fallback at all.
      onPasswordReset: async ({ user }) => {
        await mirrorCredentialToFallback(database, user.id);
      },
      password: {
        hash: hashAdminPassword,
        verify: verifyAdminPassword,
      },
      sendResetPassword: async ({ user, token }) => {
        await sendAdminAuthEmail({
          templateKey: "admin_password_reset",
          userId: user.id as UserId,
          email: user.email,
          name: user.name,
          // Our own URL, not Better Auth's `url`: the token rides as a `token=`
          // query parameter, which is the shape `redactCredentials` in the
          // dispatcher already strips out of a stored body.
          url: `${baseUrl(env)}/login/reset?token=${encodeURIComponent(token)}`,
          expiresIn: "1 hour",
        }, env);
      },
    },
    /**
     * Configured, but *not yet reachable* — stated plainly rather than left to
     * be discovered. `sendOnSignUp` is false and nothing else in `src/`,
     * `e2e/` or `scripts/` calls `/api/auth/send-verification-email`, so the
     * `admin_email_verification` template has no live sender today.
     *
     * Turning `sendOnSignUp` on would not fix that, it would make it worse:
     * `sendAdminAuthEmailIn` addresses admin mail from the organizer's oldest
     * `event_members` row, and a self-serve signup (M44) has an organization
     * but no event yet — so the mail would be skipped and logged rather than
     * sent. Wiring verification properly means giving admin mail an
     * organization-scoped address path, which belongs to whoever owns that
     * change, not to a flag flip here.
     */
    emailVerification: {
      sendOnSignUp: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, token }) => {
        await sendAdminAuthEmail({
          templateKey: "admin_email_verification",
          userId: user.id as UserId,
          email: user.email,
          name: user.name,
          url: `${baseUrl(env)}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("/login")}`,
          expiresIn: "1 hour",
        }, env);
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    socialProviders: google,
    // M44 — self-serve signup. `/sign-up/email` was closed under M42
    // (accounts were provisioned only by `createEventReviewer` and the
    // bootstrap script) and opens here; `databaseHooks.user.create.after`
    // below is what keeps an open endpoint from producing an orphaned
    // account — every freshly created `users` row lands in an organization
    // before the request that created it returns.
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const session = ctx.context.newSession;
        const password = typeof ctx.body?.password === "string" ? ctx.body.password : null;
        if (!session || !password) return;
        await rehashLegacyCredential(database, session.user.id, password);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // An invitation is a bearer credential. Validate it before Better
          // Auth inserts the user, then consume the same token in `after`.
          // This avoids both email-only membership claims and orphan users
          // when a stale or wrong-address invitation reaches signup.
          before: async (user, context) => {
            const { invitationToken } = signupProvisioningInput(context);
            if (invitationToken) {
              await assertOrganizationInvitationTokenForEmailIn(database, invitationToken, user.email);
            }
          },
          after: async (user, context) => {
            const result = await provisionNewUser(database, user, signupProvisioningInput(context));
            if (result.viaInvitation) context?.setHeader(SIGNUP_ORGANIZATION_HEADER, result.organizationId);
          },
        },
      },
      account: {
        create: {
          // The *other* moment Better Auth mints a password: a self-serve
          // signup writes the credential account, not the user row, so
          // `user.create.after` above fires too early to see it and
          // `autoSignIn: false` means the post-`/sign-up/email` middleware has
          // no session to read the user id from either. This hook is handed
          // the row itself. OAuth accounts carry no password and are skipped
          // inside `mirrorCredentialToFallback`.
          after: async (account) => {
            if (account.providerId !== "credential") return;
            await mirrorCredentialToFallback(database, account.userId);
          },
        },
      },
    },
  });
}

/**
 * M44 AC — no orphaned accounts through the new signup door. Fires for
 * *every* freshly inserted `users` row Better Auth's adapter creates — an
 * email+password `/sign-up/email` call and a Google sign-in nobody's account
 * matched, alike — and never for `createEventReviewer`/`bootstrap-admin.ts`,
 * which write `users` directly through Drizzle rather than through this
 * adapter. Better Auth awaits this hook before the signup response returns,
 * so by the time a client's subsequent "list my organizations" call lands,
 * the organization already exists.
 *
 * The Neon HTTP adapter cannot wrap Better Auth's user/account inserts and
 * our organization write in one database transaction. If provisioning fails,
 * delete the just-created user (its credential/social account cascades) before
 * failing the request. Both provisioning outcomes are themselves atomic
 * statements, so cleanup cannot leave an ownerless organization or a consumed
 * invitation without its membership.
 */
async function provisionNewUser(
  database: typeof db,
  user: { id: string; email: string; name?: string | null },
  input: SignupProvisioningInput,
): Promise<{ organizationId: string; viaInvitation: boolean }> {
  const userId = userIdSchema.parse(user.id);
  try {
    return await provisionOrganizationForNewUserIn(database, userId, user.email, user.name ?? "", input);
  } catch (error) {
    // Better Auth reports any failure on this path as its one generic
    // "unable to create user", and the Workers log serializer drops `cause`,
    // so the database's actual complaint (the only diagnosable fact here)
    // must be written out explicitly before the error leaves this function.
    log({
      level: "error",
      msg: `signup provisioning failed: ${errorChainMessages(error)}`,
      requestId: userId,
      feature: "auth",
      ...(error instanceof AppError ? { code: error.code } : {}),
    });
    try {
      await database.delete(users).where(eq(users.id, userId));
    } catch (cleanupError) {
      log({
        level: "error",
        msg: "failed to clean up user after signup provisioning error",
        requestId: userId,
        feature: "auth",
        code: cleanupError instanceof Error ? cleanupError.name : "unknown",
      });
    }
    throw error;
  }
}

/** Every message down the `cause` chain, oldest last — the deepest one is the database's. */
function errorChainMessages(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" <- ") || "unknown";
}

/**
 * M42 — the *return* leg of the two-provider credential mirror.
 *
 * `upsertCredentialAccount` (credential-account.ts) copies a freshly
 * provisioned `users.password_hash` into `admin_accounts.password` so an
 * account minted on the fallback can sign in under Better Auth. This is the
 * same copy in the other direction, and without it ".dev.vars.example: flip it
 * back at any time — both credentials stay valid" was false in two concrete
 * ways:
 *
 * - **After a reset**, `admin_accounts.password` held the new hash while
 *   `users.password_hash` still held the old one. Flipping
 *   `ADMIN_AUTH_PROVIDER` back to `fallback` re-armed the very password the
 *   user had just reset away from — the one they believe leaked.
 * - **After a self-serve signup**, the password existed *only* in
 *   `admin_accounts`, so the same flip locked the account out entirely.
 *
 * `verifyPassword` in `fallback-session.ts` was widened to accept the v2
 * scheme this writes, which is what makes the mirrored value usable on the
 * fallback rather than merely present.
 *
 * Best-effort, like `rehashLegacyCredential`: a failed mirror must not fail
 * the reset or signup the user actually asked for. The cost of losing the race
 * is a stale fallback credential — the pre-fix status quo — not a broken
 * primary provider.
 *
 * Known residual, deliberately not papered over: `revokeSessionsOnPasswordReset`
 * deletes `admin_sessions` rows, and a fallback cookie is a stateless jose JWT
 * with no row to delete. A cookie minted under `fallback`, valid 7 days, still
 * resolves if the provider is flipped back inside that window regardless of
 * any reset performed in between. Rotating `SESSION_SECRET` is the only lever
 * that invalidates it, and that is a deployment action, not something this
 * function can do.
 */
async function mirrorCredentialToFallback(database: typeof db, userId: string): Promise<void> {
  try {
    const [account] = await database.select({ password: adminAccounts.password })
      .from(adminAccounts)
      .where(and(eq(adminAccounts.userId, userId), eq(adminAccounts.providerId, "credential")))
      .limit(1);
    if (!account?.password) return;
    await database.update(users).set({ passwordHash: account.password }).where(eq(users.id, userId));
  } catch (error) {
    log({ level: "warn", msg: `fallback credential mirror failed: ${error instanceof Error ? error.message : "unknown"}`, requestId: userId, feature: "auth" });
  }
}

/**
 * M42 AC 1 — rehash-on-login.
 *
 * The only moment a legacy PBKDF2 hash can be replaced is immediately after it
 * has verified, because that is the only moment the plaintext exists. Better
 * Auth's `password.verify` hook has no user context and cannot write, so the
 * rewrite happens here, in the post-sign-in hook, and only for a session that
 * was actually created — a failed sign-in never reaches this code.
 *
 * The `WHERE password = <the legacy value>` guard makes it a no-op on a
 * concurrent second sign-in that already upgraded the row, and the whole thing
 * is best-effort: a user who just proved their password must not be handed a
 * sign-in failure because a background rewrite lost a race.
 */
async function rehashLegacyCredential(database: typeof db, userId: string, password: string): Promise<void> {
  try {
    const [account] = await database.select({ id: adminAccounts.id, password: adminAccounts.password })
      .from(adminAccounts)
      .where(and(eq(adminAccounts.userId, userId), eq(adminAccounts.providerId, "credential")))
      .limit(1);
    if (!account?.password || !needsRehash(account.password)) return;
    const upgraded = await hashAdminPassword(password);
    await database.update(adminAccounts)
      .set({ password: upgraded, updatedAt: new Date() })
      .where(and(eq(adminAccounts.id, account.id), eq(adminAccounts.password, account.password)));
  } catch (error) {
    log({ level: "warn", msg: `legacy credential rehash failed: ${error instanceof Error ? error.message : "unknown"}`, requestId: userId, feature: "auth" });
  }
}

export type AdminAuth = ReturnType<typeof buildAdminAuth>;

let cached: { auth: AdminAuth; key: string } | undefined;

/**
 * Built lazily and memoised per configuration. Nothing here runs — and none of
 * Better Auth is even imported at request time — while
 * `ADMIN_AUTH_PROVIDER=fallback`.
 */
export function getAdminAuth(env: RuntimeEnv = getEnv()): AdminAuth {
  const key = `${baseUrl(env)}|${env.SESSION_SECRET ?? ""}|${env.GOOGLE_CLIENT_ID ?? ""}|${env.APP_ENV}`;
  if (!cached || cached.key !== key) cached = { auth: buildAdminAuth(env), key };
  return cached.auth;
}
