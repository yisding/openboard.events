import { describe, expect, it } from "vitest";
import { emailFromAddress, isCredentialFreeLocalDemo, parseEnv, WEB_DEPLOY_SECRET_NAMES } from "./env";

const deployed = {
  APP_BASE_URL: "https://example.com",
  DATABASE_URL: "postgresql://example.test/db",
  SESSION_SECRET: "s".repeat(32),
  CRON_SECRET: "c".repeat(32),
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  RESEND_API_KEY: "resend",
  RESEND_WEBHOOK_SECRET: "w".repeat(32),
  UNSUBSCRIBE_SECRET: "u".repeat(32),
  SPEAKER_SHARE_SECRET: "p".repeat(32),
};

describe("parseEnv", () => {
  it("accepts credential-free local demo defaults", () => {
    const env = parseEnv({});
    expect(env.APP_ENV).toBe("local");
    expect(env.BILLING_MODE).toBe("disabled");
    expect(isCredentialFreeLocalDemo(env, "development")).toBe(true);
    expect(isCredentialFreeLocalDemo(env, "production")).toBe(false);
  });

  it("accepts the isolated preview contract", () => {
    expect(parseEnv({ ...deployed, APP_ENV: "preview", R2_BUCKET_NAME: "sb-files-preview", TEST_AUTH: "1" }).APP_ENV).toBe("preview");
  });

  it("accepts the production contract", () => {
    const env = parseEnv({
      ...deployed,
      APP_ENV: "production",
      R2_BUCKET_NAME: "sb-files",
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "events@example.com",
    });
    expect(env.TEST_AUTH).toBeUndefined();
  });

  it("rejects production test auth", () => {
    expect(() => parseEnv({
      ...deployed,
      APP_ENV: "production",
      R2_BUCKET_NAME: "sb-files",
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "events@example.com",
      TEST_AUTH: "1",
    })).toThrow(/TEST_AUTH/);
  });

  it("keeps the deferred Airtable cron disabled until a real adapter exists", () => {
    expect(parseEnv({ AIRTABLE_CRON: "0" }).AIRTABLE_CRON).toBe("0");
    expect(() => parseEnv({ AIRTABLE_CRON: "1" })).toThrow(/AIRTABLE_CRON/);
  });

  it("keeps messaging secrets optional locally but requires the complete deployed inventory", () => {
    expect(parseEnv({}).UNSUBSCRIBE_SECRET).toBeUndefined();
    const production: Record<string, unknown> = {
      ...deployed,
      APP_ENV: "production",
      R2_BUCKET_NAME: "sb-files",
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "events@example.com",
    };
    for (const key of WEB_DEPLOY_SECRET_NAMES) {
      const incomplete = { ...production };
      delete incomplete[key];
      expect(() => parseEnv(incomplete), key).toThrow(new RegExp(key));
    }
    expect(() => parseEnv({ UNSUBSCRIBE_SECRET: "too-short" })).toThrow(/UNSUBSCRIBE_SECRET/);
    expect(() => parseEnv({ RESEND_WEBHOOK_SECRET: "too-short" })).toThrow(/RESEND_WEBHOOK_SECRET/);
    expect(parseEnv({ UNSUBSCRIBE_SECRET: "u".repeat(32) }).UNSUBSCRIBE_SECRET).toBe("u".repeat(32));
  });

  it("allows the billing scaffold only as an explicit local test mode", () => {
    expect(parseEnv({ BILLING_MODE: "scaffold" }).BILLING_MODE).toBe("scaffold");
    expect(() => parseEnv({
      ...deployed,
      APP_ENV: "preview",
      R2_BUCKET_NAME: "sb-files-preview",
      BILLING_MODE: "scaffold",
    })).toThrow(/BILLING_MODE/);
    expect(() => parseEnv({ BILLING_WEBHOOK_SECRET: "too-short" })).toThrow(/BILLING_WEBHOOK_SECRET/);
  });
});

describe("EMAIL_FROM", () => {
  const preview = {
    APP_ENV: "preview",
    APP_BASE_URL: "https://sb-web-preview.yi-ding.workers.dev",
    DATABASE_URL: "postgres://x",
    SESSION_SECRET: "a".repeat(32),
    CRON_SECRET: "b".repeat(32),
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "sb-files-preview",
    RESEND_WEBHOOK_SECRET: "w".repeat(32),
    UNSUBSCRIBE_SECRET: "u".repeat(32),
    SPEAKER_SHARE_SECRET: "p".repeat(32),
  };

  it("accepts a display name, which is how a From header should read", () => {
    // Rejecting this form is what made the deployed preview tell speakers their
    // own email address was invalid: the env failed to parse and every route
    // that catches ZodError blamed the request.
    expect(() => parseEnv({ ...preview, EMAIL_FROM: "AI.Engineer Sandbox <hello@mail.openboard.events>" })).not.toThrow();
    expect(emailFromAddress("AI.Engineer Sandbox <hello@mail.openboard.events>")).toBe("hello@mail.openboard.events");
  });

  it("accepts a bare address", () => {
    expect(() => parseEnv({ ...preview, EMAIL_FROM: "hello@mail.openboard.events" })).not.toThrow();
    expect(emailFromAddress("hello@mail.openboard.events")).toBe("hello@mail.openboard.events");
  });

  it("still refuses something that is not an address", () => {
    expect(() => parseEnv({ ...preview, EMAIL_FROM: "AI.Engineer Sandbox" })).toThrow();
    expect(() => parseEnv({ ...preview, EMAIL_FROM: "Name <not-an-address>" })).toThrow();
    expect(emailFromAddress("Name <not-an-address>")).toBeNull();
  });
});
