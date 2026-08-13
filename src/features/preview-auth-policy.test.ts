import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("preview authentication policy", () => {
  it("keeps demo email fallback but removes the fallback-only admin backdoor", () => {
    const config = read("../../wrangler.jsonc");
    const previewStart = config.indexOf('"preview"');
    const productionStart = config.indexOf('"production"', previewStart);
    const preview = config.slice(previewStart, productionStart);

    expect(preview).toContain('"ADMIN_AUTH_PROVIDER": "better-auth"');
    expect(preview).toContain('"EMAIL_FALLBACK_UI": "1"');
    expect(preview).not.toContain('"TEST_AUTH"');
  });

  it("documents admin E2E as controlled-target-only", () => {
    const helper = read("../../e2e/helpers/auth.ts");
    const development = read("../../docs/development.md");

    expect(helper).toContain("controlled fallback-auth target");
    expect(helper).toContain("deployed preview and production do not expose it");
    expect(development).toContain("does not expose the");
    expect(development).toContain("fallback-only `TEST_AUTH` admin route");
  });
});
