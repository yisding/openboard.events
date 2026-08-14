import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("preview authentication policy", () => {
  it("keeps the email-delivery demo affordance without an auth-provider switch", () => {
    const config = read("../../wrangler.jsonc");
    const previewStart = config.indexOf('"preview"');
    const productionStart = config.indexOf('"production"', previewStart);
    const preview = config.slice(previewStart, productionStart);

    expect(config).toContain('"keep_vars": false');
    expect(preview).toContain('"EMAIL_FALLBACK_UI": "1"');
    expect(config).not.toContain('"ADMIN_AUTH_PROVIDER"');
    expect(preview).not.toContain('"TEST_AUTH"');
  });

  it("runs admin E2E through the real sign-in endpoint", () => {
    const helper = read("../../e2e/helpers/auth.ts");

    expect(helper).toContain('request.post("/api/auth/sign-in"');
    expect(helper).not.toContain("/api/test/login");
  });
});
