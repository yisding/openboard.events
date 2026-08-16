import { describe, expect, it } from "vitest";
import { WEB_DEPLOY_SECRET_NAMES } from "@/shared/lib/env";
import {
  missingDeploySecrets,
  requiredDeploySecrets,
  retiredDeploySecrets,
  retiredSecretDeleteCommand,
} from "../../scripts/check-deploy-secrets";

describe("deployment secret preflight", () => {
  it("uses the runtime contract as the web Worker inventory", () => {
    expect(requiredDeploySecrets("web")).toBe(WEB_DEPLOY_SECRET_NAMES);
  });

  it("requires no secret bindings on the jobs Worker", () => {
    expect(requiredDeploySecrets("jobs")).toEqual([]);
  });

  it("reports every absent binding without exposing values", () => {
    expect(missingDeploySecrets(["DATABASE_URL", "SESSION_SECRET"], ["SESSION_SECRET"]))
      .toEqual(["DATABASE_URL"]);
  });

  // Issue #633 — `keep_vars: false` prunes vars, not encrypted secrets, so a
  // retired binding survives every redeploy until somebody deletes it by name.
  it("flags a retired secret that survived its binding's removal", () => {
    expect(retiredDeploySecrets(["DATABASE_URL", "CRON_SECRET"])).toEqual(["CRON_SECRET"]);
    expect(retiredDeploySecrets(["DATABASE_URL", "SESSION_SECRET"])).toEqual([]);
  });

  it("names the exact delete command for the Worker the secret is on", () => {
    expect(retiredSecretDeleteCommand("web", "production", "CRON_SECRET"))
      .toBe("pnpm exec wrangler secret delete CRON_SECRET --env production");
    expect(retiredSecretDeleteCommand("jobs", "preview", "CRON_SECRET"))
      .toBe("pnpm exec wrangler secret delete CRON_SECRET --config workers/jobs/wrangler.jsonc --env preview");
  });
});
