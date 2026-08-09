import { describe, expect, it } from "vitest";
import { isCredentialFreeLocalDemo, parseEnv } from "./env";

const deployed = {
  APP_BASE_URL: "https://example.com",
  DATABASE_URL: "postgresql://example.test/db",
  SESSION_SECRET: "s".repeat(32),
  CRON_SECRET: "c".repeat(32),
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "access",
  R2_SECRET_ACCESS_KEY: "secret",
};

describe("parseEnv", () => {
  it("accepts credential-free local demo defaults", () => {
    const env = parseEnv({});
    expect(env.APP_ENV).toBe("local");
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
      RESEND_API_KEY: "resend",
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
      RESEND_API_KEY: "resend",
      EMAIL_FROM: "events@example.com",
      TEST_AUTH: "1",
    })).toThrow(/TEST_AUTH/);
  });

  it("requires Airtable credentials only when its cron is enabled", () => {
    expect(() => parseEnv({ AIRTABLE_CRON: "1" })).toThrow(/AIRTABLE/);
  });
});
