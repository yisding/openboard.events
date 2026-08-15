import { describe, expect, it } from "vitest";
import {
  STAGING_LIFECYCLE_RULE,
  reconcileStagingLifecycleRules,
} from "../scripts/ensure-r2-staging-lifecycle";

const unrelated = {
  id: "archive-transition",
  enabled: true,
  conditions: { prefix: "exports/" },
  storageClassTransitions: [{ storageClass: "InfrequentAccess" }],
};

describe("R2 staging lifecycle reconciliation", () => {
  it("adds the staging-only expiration without changing unrelated rules", () => {
    const result = reconcileStagingLifecycleRules([unrelated]);
    expect(result.changed).toBe(true);
    expect(result.rules).toEqual([unrelated, STAGING_LIFECYCLE_RULE]);
  });

  it("is a no-op when the exact rule is already installed", () => {
    const result = reconcileStagingLifecycleRules([unrelated, STAGING_LIFECYCLE_RULE]);
    expect(result.changed).toBe(false);
    expect(result.rules).toEqual([unrelated, STAGING_LIFECYCLE_RULE]);
  });

  it("replaces drifted or duplicate owned rules while preserving other owners", () => {
    const drifted = {
      id: "expire-staging",
      enabled: true,
      conditions: { prefix: "evt_" },
      deleteObjectsTransition: { condition: { type: "Age", maxAge: 60 } },
    };
    const result = reconcileStagingLifecycleRules([drifted, unrelated, drifted]);
    expect(result.changed).toBe(true);
    expect(result.rules).toEqual([unrelated, STAGING_LIFECYCLE_RULE]);
  });
});
