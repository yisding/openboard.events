import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.email().optional(),
);

const envSchema = z.object({
  APP_ENV: z.enum(["local", "preview", "production"]).default("local"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: optionalString,
  SESSION_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  CRON_SECRET: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_NAME: optionalString,
  EMAIL_FROM: optionalEmail,
  EMAIL_MODE: z.enum(["log", "send"]).default("log"),
  EMAIL_ALLOWLIST: optionalString,
  EMAIL_FALLBACK_UI: z.enum(["0", "1"]).default("1"),
  AIRTABLE_API_KEY: optionalString,
  AIRTABLE_BASE_ID: optionalString,
  AIRTABLE_CRON: z.enum(["0", "1"]).default("0"),
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

export function getEnv(): RuntimeEnv {
  return parseEnv(runtimeBindings());
}

export function isCredentialFreeLocalDemo(
  env: Pick<RuntimeEnv, "APP_ENV" | "DATABASE_URL" | "SESSION_SECRET"> = getEnv(),
  nodeEnv = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development" && env.APP_ENV === "local" && !env.DATABASE_URL && !env.SESSION_SECRET;
}
