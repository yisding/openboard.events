import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { AppError } from "./errors";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

/** Extract the RFC 5322 mailbox while preserving the original From header. */
export function emailFromAddress(value: string): string | null {
  const match = /^\s*(?:.*<\s*([^<>\s]+)\s*>|([^<>\s]+))\s*$/.exec(value);
  const address = match?.[1] ?? match?.[2];
  return address && z.email().safeParse(address).success ? address : null;
}

/**
 * A From header is a display name and an address — "AI.Engineer Sandbox
 * <hello@mail.openboard.events>" — and that is what makes a decision email look
 * like it came from the event rather than from a robot. Accept both forms and
 * validate the address inside.
 */
const optionalEmailFrom = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().refine(
    (value) => emailFromAddress(value) !== null,
    { message: "must be an address, optionally with a display name" },
  ).optional(),
);

const envSchema = z.object({
  APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: optionalString,
  SESSION_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  // P3-EMAIL: signs Resend's bounce/complaint webhook (Svix scheme). Left
  // optional everywhere — the bounce webhook is provisioned in Resend's
  // dashboard after a sending domain exists, an external step the roadmap's
  // email-deliverability tail explicitly tracks as still in progress
  // (plan/status.md); the route itself 500s with a clear message until it's
  // set, rather than silently accepting unverified webhook calls.
  RESEND_WEBHOOK_SECRET: optionalString,
  // M46 — unsubscribe tokens (the JWT behind `/portal/[eventSlug]/unsubscribe`)
  // are signed with this dedicated key rather than `SESSION_SECRET`, so
  // rotating a session secret can never invalidate an outstanding
  // unsubscribe link (and vice versa: this key rotating never signs a
  // speaker out). Left optional everywhere, same posture as
  // `RESEND_WEBHOOK_SECRET` above — additive, not a required-env breaking
  // change — because the deployed preview/production Workers have not had
  // this secret provisioned yet; `unsubscribe.ts`/`context.ts` fail closed
  // with a clear `INTERNAL` message the moment a non-essential email
  // actually needs to sign one, rather than the whole environment refusing
  // to parse until someone runs `wrangler secret put`.
  UNSUBSCRIBE_SECRET: optionalString,
  // M59 — signs the "I'm speaking!" share-page token
  // (`/speaking/[token]`), same dedicated-key posture as
  // `UNSUBSCRIBE_SECRET` right above and for the same reason: the token is
  // handed to whatever the speaker pastes it into (a tweet, a Slack
  // message), so its lifecycle has nothing to do with an admin session's or
  // an unsubscribe link's. Left optional for the same deploy-ordering
  // reason — `share.ts` fails closed with a clear `INTERNAL` message the
  // moment a share link is actually requested, rather than the whole
  // environment refusing to parse until this is provisioned.
  SPEAKER_SHARE_SECRET: optionalString,
  // M49 — signs the billing provider webhook (`/api/webhooks/billing`), same
  // shared-secret-HMAC posture as `RESEND_WEBHOOK_SECRET` above and left
  // optional for the same reason: no live payment provider is connected yet
  // (`src/features/billing/server/provider.ts`'s `StubBillingProviderAdapter`
  // is the only adapter implemented), so nothing has this provisioned. The
  // webhook route fails closed (rejects every event) rather than accepting
  // an unverified one when it is unset.
  BILLING_WEBHOOK_SECRET: optionalString,
  CRON_SECRET: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  EMAIL_FROM: optionalEmailFrom,
  EMAIL_MODE: z.enum(["log", "send"]).default("log"),
  EMAIL_ALLOWLIST: optionalString,
  EMAIL_FALLBACK_UI: z.enum(["0", "1"]).default("1"),
  AIRTABLE_API_KEY: optionalString,
  AIRTABLE_BASE_ID: optionalString,
  AIRTABLE_CRON: z.enum(["0", "1"]).default("0"),
  /**
   * M42 — which implementation backs `requireAdmin`.
   *
   * `fallback` (the default, and what every deployed environment runs today) is
   * M06a's jose/PBKDF2 stateless cookie. `better-auth` is the M42
   * implementation: Better Auth over the Drizzle adapter, with revocable
   * server-side sessions in `admin_sessions`.
   *
   * Defaulting to `fallback` is the guardrail DECISIONS.md ("Product auth
   * direction") states in as many words: the fallback remains the shipping auth
   * until a deployed Better Auth round-trip is proven on the preview. Flipping
   * this variable is that proof's first step, and it is reversible without a
   * deploy — the two providers read disjoint storage, so a session minted under
   * either one survives the switch being flipped back.
   */
  ADMIN_AUTH_PROVIDER: z.enum(["fallback", "better-auth"]).default("fallback"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /**
   * The origin Better Auth builds callback and email URLs from. Optional and
   * defaulted to `APP_BASE_URL` at the point of use — one origin, not two, is
   * the normal case; this exists because Google's authorized-redirect-URI list
   * is configured per origin and a preview may need to differ.
   */
  BETTER_AUTH_URL: optionalString,
  TEST_AUTH: z.enum(["1"]).optional(),
  NEXT_PUBLIC_BUILD_SHA: optionalString,
}).superRefine((env, context) => {
  const url = new URL(env.APP_BASE_URL);
  if (url.origin !== env.APP_BASE_URL) {
    context.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "must be an origin with no path or trailing slash" });
  }

  if (env.APP_ENV !== "local") {
    const required = [
      "DATABASE_URL",
      "SESSION_SECRET",
      "CRON_SECRET",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ] as const;
    for (const key of required) {
      if (!env[key]) context.addIssue({ code: "custom", path: [key], message: `is required in ${env.APP_ENV}` });
    }
    if (url.protocol !== "https:") {
      context.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "must use https when deployed" });
    }
    if (env.SESSION_SECRET && env.SESSION_SECRET.length < 32) {
      context.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "must be at least 32 characters" });
    }
    if (env.CRON_SECRET && env.CRON_SECRET.length < 32) {
      context.addIssue({ code: "custom", path: ["CRON_SECRET"], message: "must be at least 32 characters" });
    }
  }
  // M42 — fail closed rather than half-configured. Better Auth signs its
  // session cookies with SESSION_SECRET and needs an origin to build callbacks
  // from; Google is optional (email+password alone is a complete sign-in path)
  // but a half-supplied client id/secret pair is always a mistake.
  if (env.ADMIN_AUTH_PROVIDER === "better-auth") {
    if (!env.SESSION_SECRET) {
      context.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "is required when ADMIN_AUTH_PROVIDER=better-auth" });
    }
    if (env.BETTER_AUTH_URL) {
      const parsed = z.url().safeParse(env.BETTER_AUTH_URL);
      if (!parsed.success || new URL(parsed.data).origin !== env.BETTER_AUTH_URL) {
        context.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be an origin with no path or trailing slash" });
      }
    }
  }
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    context.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together" });
  }

  // Hygiene applies whenever the value is present, not only when deployed —
  // matches the pattern above, but UNSUBSCRIBE_SECRET itself stays optional
  // (see its schema comment) so a short value is the only way to fail here.
  if (env.UNSUBSCRIBE_SECRET && env.UNSUBSCRIBE_SECRET.length < 32) {
    context.addIssue({ code: "custom", path: ["UNSUBSCRIBE_SECRET"], message: "must be at least 32 characters" });
  }
  if (env.SPEAKER_SHARE_SECRET && env.SPEAKER_SHARE_SECRET.length < 32) {
    context.addIssue({ code: "custom", path: ["SPEAKER_SHARE_SECRET"], message: "must be at least 32 characters" });
  }

  const expectedBucket = env.APP_ENV === "production" ? "sb-files" : env.APP_ENV === "preview" ? "sb-files-preview" : undefined;
  if (expectedBucket && env.R2_BUCKET_NAME !== expectedBucket) {
    context.addIssue({ code: "custom", path: ["R2_BUCKET_NAME"], message: `must be ${expectedBucket}` });
  }

  if (env.APP_ENV === "production") {
    if (env.EMAIL_MODE !== "send") context.addIssue({ code: "custom", path: ["EMAIL_MODE"], message: "must be send in production" });
    if (env.EMAIL_FALLBACK_UI !== "0") context.addIssue({ code: "custom", path: ["EMAIL_FALLBACK_UI"], message: "must be 0 in production" });
    if (env.TEST_AUTH) context.addIssue({ code: "custom", path: ["TEST_AUTH"], message: "must be unset in production" });
    if (!env.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required in production" });
    if (!env.EMAIL_FROM) context.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "is required in production" });
    if (env.EMAIL_ALLOWLIST) context.addIssue({ code: "custom", path: ["EMAIL_ALLOWLIST"], message: "must be unset in production" });
  }

  if (env.APP_ENV === "preview" && env.EMAIL_MODE === "send") {
    if (!env.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required when preview email sends" });
    if (!env.EMAIL_FROM) context.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "is required when preview email sends" });
    if (!env.EMAIL_ALLOWLIST) context.addIssue({ code: "custom", path: ["EMAIL_ALLOWLIST"], message: "is required when preview email sends" });
  }

  if (env.AIRTABLE_CRON === "1") {
    if (!env.AIRTABLE_API_KEY) context.addIssue({ code: "custom", path: ["AIRTABLE_API_KEY"], message: "is required when AIRTABLE_CRON=1" });
    if (!env.AIRTABLE_BASE_ID) context.addIssue({ code: "custom", path: ["AIRTABLE_BASE_ID"], message: "is required when AIRTABLE_CRON=1" });
  }
});

export type RuntimeEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, unknown>): RuntimeEnv {
  return envSchema.parse(input);
}

function runtimeBindings(): Record<string, unknown> {
  try {
    return getCloudflareContext().env as unknown as Record<string, unknown>;
  } catch {
    return process.env;
  }
}

/**
 * A misconfigured environment is a server fault, and it has to say so. Left as a
 * raw ZodError it is indistinguishable from bad user input to every route that
 * catches ZodError — which is how a broken EMAIL_FROM ends up telling a speaker
 * their own email address is invalid.
 */
export function getEnv(): RuntimeEnv {
  const result = envSchema.safeParse(runtimeBindings());
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `${issue.path.join(".") || "env"} ${issue.message}`)
    .join("; ");
  throw new AppError("INTERNAL", `Server configuration is invalid: ${problems}`);
}

export function isCredentialFreeLocalDemo(
  env: Pick<RuntimeEnv, "APP_ENV" | "DATABASE_URL" | "SESSION_SECRET"> = getEnv(),
  nodeEnv = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development" && env.APP_ENV === "local" && !env.DATABASE_URL && !env.SESSION_SECRET;
}
