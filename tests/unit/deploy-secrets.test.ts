import { describe, expect, it } from "vitest";
import { WEB_DEPLOY_SECRET_NAMES } from "@/shared/lib/env";
import { missingDeploySecrets, requiredDeploySecrets } from "../../scripts/check-deploy-secrets";

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
});
