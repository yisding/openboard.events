import { basename } from "node:path";
import { cloudflareRequest, requireCloudflareCredentials } from "./lib/cloudflare";

export const STAGING_LIFECYCLE_RULE_ID = "expire-staging";
export const STAGING_LIFECYCLE_PREFIX = "staging/";
export const STAGING_LIFECYCLE_MAX_AGE_SECONDS = 2 * 24 * 60 * 60;

export type LifecycleRule = {
  id: string;
  enabled: boolean;
  conditions: { prefix: string };
  deleteObjectsTransition?: { condition: { type: string; maxAge?: number; date?: string } };
  abortMultipartUploadsTransition?: unknown;
  storageClassTransitions?: unknown[];
};

export const STAGING_LIFECYCLE_RULE: LifecycleRule = {
  id: STAGING_LIFECYCLE_RULE_ID,
  enabled: true,
  conditions: { prefix: STAGING_LIFECYCLE_PREFIX },
  deleteObjectsTransition: {
    condition: { type: "Age", maxAge: STAGING_LIFECYCLE_MAX_AGE_SECONDS },
  },
};

export function isStagingLifecycleRule(rule: LifecycleRule): boolean {
  return rule.id === STAGING_LIFECYCLE_RULE_ID
    && rule.enabled === true
    && rule.conditions?.prefix === STAGING_LIFECYCLE_PREFIX
    && rule.deleteObjectsTransition?.condition.type === "Age"
    && rule.deleteObjectsTransition.condition.maxAge === STAGING_LIFECYCLE_MAX_AGE_SECONDS
    && rule.abortMultipartUploadsTransition === undefined
    && (rule.storageClassTransitions === undefined || rule.storageClassTransitions.length === 0);
}

/** Preserve unrelated bucket policy while making this repository's one rule exact. */
export function reconcileStagingLifecycleRules(existing: readonly LifecycleRule[]): {
  changed: boolean;
  rules: LifecycleRule[];
} {
  const matching = existing.filter((rule) => rule.id === STAGING_LIFECYCLE_RULE_ID);
  if (matching.length === 1 && matching[0] && isStagingLifecycleRule(matching[0])) {
    return { changed: false, rules: [...existing] };
  }
  return {
    changed: true,
    rules: [
      ...existing.filter((rule) => rule.id !== STAGING_LIFECYCLE_RULE_ID),
      STAGING_LIFECYCLE_RULE,
    ],
  };
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target !== "preview" && target !== "production") {
    throw new Error("usage: ensure-r2-staging-lifecycle.ts preview|production");
  }
  const { accountId, apiToken } = requireCloudflareCredentials();
  const bucket = target === "preview" ? "sb-files-preview" : "sb-files";
  const lifecyclePath = `accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/lifecycle`;

  const current = await cloudflareRequest<{ rules?: LifecycleRule[] }>(apiToken, lifecyclePath, {
    method: "GET",
    failureLabel: "Cloudflare lifecycle GET failed",
  });
  const reconciled = reconcileStagingLifecycleRules(current.rules ?? []);
  if (reconciled.changed) {
    // The PUT answers `success: true` with no `result`, which is a success here.
    await cloudflareRequest(apiToken, lifecyclePath, {
      method: "PUT",
      body: JSON.stringify({ rules: reconciled.rules }),
      expectResult: false,
      failureLabel: "Cloudflare lifecycle PUT failed",
    });
  }

  const verified = await cloudflareRequest<{ rules?: LifecycleRule[] }>(apiToken, lifecyclePath, {
    method: "GET",
    failureLabel: "Cloudflare lifecycle GET failed",
  });
  const matches = (verified.rules ?? []).filter((rule) => rule.id === STAGING_LIFECYCLE_RULE_ID);
  if (matches.length !== 1 || !matches[0] || !isStagingLifecycleRule(matches[0])) {
    throw new Error(`R2 lifecycle rule ${STAGING_LIFECYCLE_RULE_ID} did not verify on ${bucket}`);
  }
  console.log(JSON.stringify({
    bucket,
    changed: reconciled.changed,
    ruleId: STAGING_LIFECYCLE_RULE_ID,
    prefix: STAGING_LIFECYCLE_PREFIX,
    expireDays: STAGING_LIFECYCLE_MAX_AGE_SECONDS / (24 * 60 * 60),
    verified: true,
  }));
}

if (process.argv[1] && basename(process.argv[1]) === "ensure-r2-staging-lifecycle.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
