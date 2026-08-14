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

const optionalLegalVersion = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/iu, "must be a stable version identifier").optional(),
);

const optionalLegalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.url().optional(),
);

/** Secret bindings every deployed web Worker must carry before release. */
export const WEB_DEPLOY_SECRET_NAMES = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "UNSUBSCRIBE_SECRET",
  "SPEAKER_SHARE_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

const envSchema = z.object({
  APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: optionalString,
  SESSION_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  // P3-EMAIL: signs Resend's bounce/complaint webhook (Svix scheme). Optional
  // for the credential-free local demo, required in deployed environments.
  RESEND_WEBHOOK_SECRET: optionalString,
  // M46 — unsubscribe tokens (the JWT behind `/portal/[eventSlug]/unsubscribe`)
  // are signed with this dedicated key rather than `SESSION_SECRET`, so
  // rotating a session secret can never invalidate an outstanding
  // unsubscribe link (and vice versa: this key rotating never signs a
  // speaker out). Left optional for local development, same posture as
  // `RESEND_WEBHOOK_SECRET` above. Optional locally; deployed email must not
  // discover the missing key only after a customer tries to unsubscribe.
  UNSUBSCRIBE_SECRET: optionalString,
  // M59 — signs the "I'm speaking!" share-page token
  // (`/speaking/[token]`), same dedicated-key posture as
  // `UNSUBSCRIBE_SECRET` right above and for the same reason: the token is
  // handed to whatever the speaker pastes it into (a tweet, a Slack
  // message), so its lifecycle has nothing to do with an admin session's or
  // an unsubscribe link's. `share.ts` also fails closed with a clear
  // `INTERNAL` message if a local developer reaches the feature without it.
  // Deployed environments require it because the share surface is public UI.
  SPEAKER_SHARE_SECRET: optionalString,
  // M49 — signs the billing provider webhook (`/api/webhooks/billing`), same
  // shared-secret-HMAC posture as `RESEND_WEBHOOK_SECRET` above and left
  // optional for the same reason: no live payment provider is connected yet
  // (`src/features/billing/server/provider.ts`'s `StubBillingProviderAdapter`
  // is the only adapter implemented), so nothing has this provisioned. The
  // webhook route fails closed (rejects every event) rather than accepting
  // an unverified one when it is unset.
  BILLING_WEBHOOK_SECRET: optionalString,
  // Customer-facing billing stays absent until a real provider exists.
  // `scaffold` is an explicit local-only switch for manual seam testing.
  BILLING_MODE: z.enum(["disabled", "scaffold"]).default("disabled"),
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
  // M39 is deferred and has no production implementation. A deployed flag
  // must not make a missing integration look like successful scheduled work.
  AIRTABLE_CRON: z.literal("0").default("0"),
  // Retired settings stay explicit for one release so stale deployment or
  // local configuration fails closed instead of silently implying a switch
  // that no longer exists.
  ADMIN_AUTH_PROVIDER: z.never().optional(),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  // Reviewed customer terms live outside the repository until their drafts in
  // docs/legal are approved. These four values are therefore one atomic
  // configuration: the URLs identify the published documents and the stable
  // versions are what signup records. Any environment may omit all four while
  // legal review is pending; as soon as one is configured, all four are
  // required and signup enforcement activates.
  LEGAL_TERMS_URL: optionalLegalUrl,
  LEGAL_TERMS_VERSION: optionalLegalVersion,
  LEGAL_PRIVACY_URL: optionalLegalUrl,
  LEGAL_PRIVACY_VERSION: optionalLegalVersion,
  /**
   * The origin Better Auth builds callback and email URLs from. Optional and
   * defaulted to `APP_BASE_URL` at the point of use — one origin, not two, is
   * the normal case; this exists because Google's authorized-redirect-URI list
   * is configured per origin and a preview may need to differ.
   */
  BETTER_AUTH_URL: optionalString,
  TEST_AUTH: z.never().optional(),
  // Server/runtime release identity. This deliberately has no `NEXT_PUBLIC_`
  // prefix: only `/api/health` reads it, and asking Next to inline a changing
  // SHA into the client/server compilation materially inflates the Worker.
  BUILD_SHA: optionalLegalVersion,
  DEPLOYMENT_ID: optionalLegalVersion,
}).superRefine((env, context) => {
  const url = new URL(env.APP_BASE_URL);
  if (url.origin !== env.APP_BASE_URL) {
    context.addIssue({ code: "custom", path: ["APP_BASE_URL"], message: "must be an origin with no path or trailing slash" });
  }

  if (env.APP_ENV !== "local") {
    const required = [
      "DATABASE_URL",
      "SESSION_SECRET",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "DEPLOYMENT_ID",
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
  }
  // Better Auth is the only admin provider and needs an origin to build
  // callbacks from. SESSION_SECRET is part of the deployed required set above.
  if (env.BETTER_AUTH_URL) {
    const parsed = z.url().safeParse(env.BETTER_AUTH_URL);
    if (!parsed.success || new URL(parsed.data).origin !== env.BETTER_AUTH_URL) {
      context.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be an origin with no path or trailing slash" });
    }
  }
  if (env.APP_ENV !== "local" && !env.GOOGLE_CLIENT_ID) {
    context.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_ID"], message: `is required for Google sign-in in ${env.APP_ENV}` });
  }
  if (env.APP_ENV !== "local" && !env.GOOGLE_CLIENT_SECRET) {
    context.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: `is required for Google sign-in in ${env.APP_ENV}` });
  }
  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    context.addIssue({ code: "custom", path: ["GOOGLE_CLIENT_SECRET"], message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together" });
  }

  const legalKeys = [
    "LEGAL_TERMS_URL",
    "LEGAL_TERMS_VERSION",
    "LEGAL_PRIVACY_URL",
    "LEGAL_PRIVACY_VERSION",
  ] as const;
  const configuredLegalKeys = legalKeys.filter((key) => Boolean(env[key]));
  if (configuredLegalKeys.length > 0 && configuredLegalKeys.length < legalKeys.length) {
    for (const key of legalKeys) {
      if (!env[key]) context.addIssue({ code: "custom", path: [key], message: "is required when signup legal consent is configured" });
    }
  }
  for (const key of ["LEGAL_TERMS_URL", "LEGAL_PRIVACY_URL"] as const) {
    if (env.APP_ENV !== "local" && env[key] && new URL(env[key]).protocol !== "https:") {
      context.addIssue({ code: "custom", path: [key], message: "must use https when deployed" });
    }
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
  if (env.RESEND_WEBHOOK_SECRET && env.RESEND_WEBHOOK_SECRET.length < 32) {
    context.addIssue({ code: "custom", path: ["RESEND_WEBHOOK_SECRET"], message: "must be at least 32 characters" });
  }
  if (env.BILLING_WEBHOOK_SECRET && env.BILLING_WEBHOOK_SECRET.length < 32) {
    context.addIssue({ code: "custom", path: ["BILLING_WEBHOOK_SECRET"], message: "must be at least 32 characters" });
  }

  if (env.APP_ENV !== "local") {
    for (const key of ["RESEND_WEBHOOK_SECRET", "UNSUBSCRIBE_SECRET", "SPEAKER_SHARE_SECRET"] as const) {
      if (!env[key]) context.addIssue({ code: "custom", path: [key], message: `is required in ${env.APP_ENV}` });
    }
    if (env.BILLING_MODE !== "disabled") {
      context.addIssue({ code: "custom", path: ["BILLING_MODE"], message: `must be disabled in ${env.APP_ENV} until a real provider adapter exists` });
    }
  }

  const expectedBucket = env.APP_ENV === "production" ? "sb-files" : env.APP_ENV === "preview" ? "sb-files-preview" : undefined;
  if (expectedBucket && env.R2_BUCKET_NAME !== expectedBucket) {
    context.addIssue({ code: "custom", path: ["R2_BUCKET_NAME"], message: `must be ${expectedBucket}` });
  }

  if (env.APP_ENV === "production") {
    if (env.EMAIL_MODE !== "send") context.addIssue({ code: "custom", path: ["EMAIL_MODE"], message: "must be send in production" });
    if (env.EMAIL_FALLBACK_UI !== "0") context.addIssue({ code: "custom", path: ["EMAIL_FALLBACK_UI"], message: "must be 0 in production" });
    if (!env.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required in production" });
    if (!env.EMAIL_FROM) context.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "is required in production" });
    if (env.EMAIL_ALLOWLIST) context.addIssue({ code: "custom", path: ["EMAIL_ALLOWLIST"], message: "must be unset in production" });
  }

  if (env.APP_ENV === "preview" && env.EMAIL_MODE === "send") {
    if (!env.RESEND_API_KEY) context.addIssue({ code: "custom", path: ["RESEND_API_KEY"], message: "is required when preview email sends" });
    if (!env.EMAIL_FROM) context.addIssue({ code: "custom", path: ["EMAIL_FROM"], message: "is required when preview email sends" });
    if (!env.EMAIL_ALLOWLIST) context.addIssue({ code: "custom", path: ["EMAIL_ALLOWLIST"], message: "is required when preview email sends" });
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
