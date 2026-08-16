import { describe, expect, it } from "vitest";
import { emailFromAddress, parseEnv, WEB_DEPLOY_SECRET_NAMES } from "./env";

const deployed = {
  APP_BASE_URL: "https://example.com",
  DATABASE_URL: "postgresql://example.test/db",
  SESSION_SECRET: "s".repeat(32),
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
  DEPLOYMENT_ID: "31738715715-2-preview",
  RESEND_API_KEY: "resend",
  EMAIL_REPLY_TO: "replies@example.com",
  RESEND_WEBHOOK_SECRET: "w".repeat(32),
  UNSUBSCRIBE_SECRET: "u".repeat(32),
  SPEAKER_SHARE_SECRET: "p".repeat(32),
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  LEGAL_TERMS_URL: "https://example.com/terms",
  LEGAL_TERMS_VERSION: "2026-08-12",
  LEGAL_PRIVACY_URL: "https://example.com/privacy",
  LEGAL_PRIVACY_VERSION: "2026-08-12",
};

describe("parseEnv", () => {
  it("accepts bare local defaults", () => {
    const env = parseEnv({});
    expect(env.APP_ENV).toBe("local");
    expect(env.BILLING_MODE).toBe("disabled");
  });

  it("keeps the release SHA in the server runtime contract", () => {
    expect(parseEnv({ BUILD_SHA: "abc123def456" }).BUILD_SHA).toBe("abc123def456");
    expect(() => parseEnv({ BUILD_SHA: "not a release SHA" })).toThrow(/BUILD_SHA/);
  });

  it("accepts the isolated preview contract", () => {
    expect(parseEnv({ ...deployed, APP_ENV: "preview", R2_BUCKET_NAME: "sb-files-preview" }).APP_ENV).toBe("preview");
  });

  it("requires a stable identity for every deployed Worker instance", () => {
    const preview = { ...deployed, APP_ENV: "preview", R2_BUCKET_NAME: "sb-files-preview" };
    expect(() => parseEnv({ ...preview, DEPLOYMENT_ID: undefined })).toThrow(/DEPLOYMENT_ID/);
    expect(() => parseEnv({ ...preview, DEPLOYMENT_ID: "run id with spaces" })).toThrow(/DEPLOYMENT_ID/);
  });

  it("allows preview to omit the entire policy set while legal review is pending", () => {
    const preview: Record<string, unknown> = { ...deployed, APP_ENV: "preview", R2_BUCKET_NAME: "sb-files-preview" };
    delete preview.LEGAL_TERMS_URL;
    delete preview.LEGAL_TERMS_VERSION;
    delete preview.LEGAL_PRIVACY_URL;
    delete preview.LEGAL_PRIVACY_VERSION;
    expect(() => parseEnv(preview)).not.toThrow();
  });

  it("keeps production deployable while the reviewed policy set is still pending", () => {
    const production: Record<string, unknown> = {
      ...deployed,
      APP_ENV: "production",
      R2_BUCKET_NAME: "sb-files",
      EMAIL_MODE: "send",
      EMAIL_FALLBACK_UI: "0",
      EMAIL_FROM: "events@example.com",
    };
    delete production.LEGAL_TERMS_URL;
    delete production.LEGAL_TERMS_VERSION;
    delete production.LEGAL_PRIVACY_URL;
    delete production.LEGAL_PRIVACY_VERSION;
    expect(() => parseEnv(production)).not.toThrow();
  });

  it("rejects partial, unstable, or insecure deployed policy configuration", () => {
    expect(() => parseEnv({ LEGAL_TERMS_VERSION: "2026-08-12" })).toThrow(/LEGAL_TERMS_URL/);
    expect(() => parseEnv({
      ...deployed,
      APP_ENV: "preview",
      R2_BUCKET_NAME: "sb-files-preview",
      LEGAL_TERMS_VERSION: "not a stable version!",
    })).toThrow(/LEGAL_TERMS_VERSION/);
    expect(() => parseEnv({
      ...deployed,
      APP_ENV: "preview",
      R2_BUCKET_NAME: "sb-files-preview",
      LEGAL_PRIVACY_URL: "http://example.com/privacy",
    })).toThrow(/LEGAL_PRIVACY_URL/);
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
    expect(env.APP_ENV).toBe("production");
  });

  it("rejects retired auth switches in every environment", () => {
    expect(() => parseEnv({ TEST_AUTH: "1" })).toThrow(/TEST_AUTH/);
    expect(() => parseEnv({ ADMIN_AUTH_PROVIDER: "fallback" })).toThrow(/ADMIN_AUTH_PROVIDER/);
    expect(() => parseEnv({ ADMIN_AUTH_PROVIDER: "better-auth" })).toThrow(/ADMIN_AUTH_PROVIDER/);
  });

  it("requires Google credentials for every deployed admin auth environment", () => {
    const preview = {
      ...deployed,
      APP_ENV: "preview",
      R2_BUCKET_NAME: "sb-files-preview",
    };
    expect(() => parseEnv(preview)).not.toThrow();
    expect(() => parseEnv({ ...preview, GOOGLE_CLIENT_ID: undefined })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => parseEnv({ ...preview, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it("gates the Airtable scheduled sweep behind an explicit flag, defaulting off", () => {
    expect(parseEnv({}).AIRTABLE_CRON).toBe("0");
    expect(parseEnv({ AIRTABLE_CRON: "0" }).AIRTABLE_CRON).toBe("0");
    expect(parseEnv({ AIRTABLE_CRON: "1" }).AIRTABLE_CRON).toBe("1");
    expect(() => parseEnv({ AIRTABLE_CRON: "2" })).toThrow(/AIRTABLE_CRON/);
  });

  it("keeps the global Airtable API key a local-only convenience", () => {
    expect(parseEnv({ AIRTABLE_API_KEY: "pat-local-scratch" }).AIRTABLE_API_KEY)
      .toBe("pat-local-scratch");
    expect(() => parseEnv({ ...deployed, APP_ENV: "production", AIRTABLE_API_KEY: "pat-leaked" }))
      .toThrow(/AIRTABLE_API_KEY/);
    expect(() => parseEnv({
      ...deployed,
      APP_ENV: "preview",
      R2_BUCKET_NAME: "sb-files-preview",
      AIRTABLE_API_KEY: "pat-leaked",
    })).toThrow(/AIRTABLE_API_KEY/);
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

describe("email sender identity", () => {
  const preview = {
    APP_ENV: "preview",
    APP_BASE_URL: "https://sb-web-preview.yi-ding.workers.dev",
    DATABASE_URL: "postgres://x",
    SESSION_SECRET: "a".repeat(32),
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "sb-files-preview",
    DEPLOYMENT_ID: "email-test-preview",
    RESEND_WEBHOOK_SECRET: "w".repeat(32),
    UNSUBSCRIBE_SECRET: "u".repeat(32),
    SPEAKER_SHARE_SECRET: "p".repeat(32),
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
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

  it("accepts only a mailbox for Reply-To", () => {
    expect(parseEnv({ EMAIL_REPLY_TO: "replies@example.com" }).EMAIL_REPLY_TO).toBe("replies@example.com");
    expect(() => parseEnv({ EMAIL_REPLY_TO: "Openboard <replies@example.com>" })).toThrow(/EMAIL_REPLY_TO/);
  });

  it("requires Reply-To whenever deployed email sending is enabled", () => {
    const sendPreview = {
      ...preview,
      EMAIL_MODE: "send",
      EMAIL_FROM: "Openboard <hello@mail.openboard.events>",
      EMAIL_ALLOWLIST: "speaker@example.com",
      RESEND_API_KEY: "resend",
    };
    expect(() => parseEnv(sendPreview)).toThrow(/EMAIL_REPLY_TO/);
    expect(() => parseEnv({ ...sendPreview, EMAIL_REPLY_TO: "hello@openboard.events" })).not.toThrow();
  });
});
